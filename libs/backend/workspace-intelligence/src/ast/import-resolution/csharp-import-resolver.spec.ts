/**
 * Specs for the C# import resolver (TASK_2026_559 Batch 34, Task 34.1):
 * `using N`, nested and file-scoped namespaces, the enclosing-namespace
 * lookup, `using static`, aliases, `global using` per project, the proof
 * rules for external namespaces, and the per-import bound.
 *
 * Most tests run the real parser (the real `tree-sitter-c-sharp.wasm`, so
 * declarations, `scopePath` and import kinds are the 32a extraction's) and
 * the real `DependencyGraphService` over a temporary directory, so `.csproj`
 * files go through the bounded, identity-checked manifest reader. The two
 * grammar shims are the ones `csharp-grammar.integration.spec.ts` explains.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Result } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import { isCleanAnswer } from '@ptah-extension/platform-core';

jest.mock('../wasm-bundle-dir', () => {
  const nodePath = require('path');
  const grammarDir = nodePath.join(
    nodePath.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
    'wasm',
  );
  const runtimeDir = nodePath.dirname(require.resolve('web-tree-sitter'));
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? nodePath.join(runtimeDir, filename)
        : nodePath.join(grammarDir, filename),
  };
});

jest.mock('web-tree-sitter', () => {
  const actual =
    jest.requireActual<typeof import('web-tree-sitter')>('web-tree-sitter');
  const nodeFs = require('fs');
  const loadFromPathOrBuffer = actual.Language.load.bind(actual.Language);
  actual.Language.load = (input: string | Uint8Array) =>
    loadFromPathOrBuffer(
      typeof input === 'string'
        ? new Uint8Array(nodeFs.readFileSync(input))
        : input,
    );
  return actual;
});

import type { CodeInsights } from '../ast-analysis.interfaces';
import { AstAnalysisService } from '../ast-analysis.service';
import { DependencyGraphService } from '../dependency-graph.service';
import { TreeSitterParserService } from '../tree-sitter-parser.service';
import type { FileSystemService } from '../../services/file-system.service';
import { readMsbuildItems } from './csharp-context';
import { CSHARP_IMPORT_RESOLVER } from './csharp-import-resolver';
import { NODE_MANIFEST_FILE_SYSTEM, toForwardSlashes } from './manifest-reader';
import { buildResolverContext } from './resolver-context';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

const fileSystem = {
  readFile: async (p: string) => fs.readFileSync(p, 'utf8'),
} as unknown as FileSystemService;

let parser: TreeSitterParserService;
let analysis: AstAnalysisService;
let root: string;

beforeAll(async () => {
  parser = new TreeSitterParserService(logger);
  const init = await parser.initialize();
  if (init.isErr()) throw init.error ?? new Error('tree-sitter init failed');
  analysis = new AstAnalysisService(logger, parser);
}, 60_000);

afterAll(() => parser.dispose());

beforeEach(() => {
  root = toForwardSlashes(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-cs-resolver-')),
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const at = (...files: string[]) => files.map((file) => `${root}/${file}`);

/** Write `files` (relative → content); graph every `.cs` among them. */
async function graphOf(files: Readonly<Record<string, string>>) {
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  const svc = new DependencyGraphService(analysis, fileSystem, logger);
  await svc.buildGraph(
    at(...Object.keys(files).filter((rel) => rel.endsWith('.cs'))),
    root,
  );
  const deps = (rel: string) =>
    [...svc.getDependencies(`${root}/${rel}`)].sort();
  const coverage = () => svc.getCoverageReport(root)?.languages;
  return { svc, deps, coverage };
}

const BILLING = {
  'Billing/Invoice.cs':
    'namespace Acme.Billing;\npublic class Invoice { public void Send() {} }\n',
  'Billing/Order.cs':
    'namespace Acme.Billing\n{\n    public class Order {}\n}\n',
  'Util/MathX.cs':
    'namespace Acme.Util;\npublic static class MathX { public static int Twice(int x) => x * 2; }\n',
  'Util/Clock.cs': 'namespace Acme.Util;\ninternal static class Clock {}\n',
};

describe('CSHARP_IMPORT_RESOLVER — namespace edges', () => {
  it('`using N` links every file declaring N (block and file-scoped), and discloses the approximation', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'App/Program.cs':
        'using System;\nusing Acme.Billing;\n\nnamespace Acme.App;\npublic class Program {}\n',
    });
    expect(deps('App/Program.cs')).toEqual(
      at('Billing/Invoice.cs', 'Billing/Order.cs'),
    );
    const report = coverage();
    expect(report?.approximations).toContain('csharp:namespace-edges');
    expect(report?.resolution).toMatchObject({
      external: 1,
      unresolvedInternal: 0,
      truncatedImports: 0,
      context: 'complete',
    });
  });

  it('composes nested namespaces: `namespace A { namespace B.C }` declares A.B.C', async () => {
    const { deps } = await graphOf({
      'Core/Deep.cs':
        'namespace Acme\n{\n    namespace Billing.Core\n    {\n        public class Deep {}\n    }\n}\n',
      'App/Use.cs': 'using Acme.Billing.Core;\npublic class Use {}\n',
    });
    expect(deps('App/Use.cs')).toEqual(at('Core/Deep.cs'));
  });

  it('looks a using inside `namespace Acme.App { … }` up in Acme.App, then Acme, then globally', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'App/Inner.cs':
        'namespace Acme.App\n{\n    using Billing;\n    public class Inner {}\n}\n',
    });
    expect(deps('App/Inner.cs')).toEqual(
      at('Billing/Invoice.cs', 'Billing/Order.cs'),
    );
    expect(coverage()?.resolution?.context).toBe('complete');
  });

  it('`global::` names are looked up in the global namespace only', async () => {
    const { deps } = await graphOf({
      ...BILLING,
      'Billing/Shadow.cs':
        'namespace Acme.App.Acme.Billing;\npublic class Shadow {}\n',
      'App/Inner.cs':
        'namespace Acme.App\n{\n    using global::Acme.Billing;\n    public class Inner {}\n}\n',
    });
    expect(deps('App/Inner.cs')).toEqual(
      at('Billing/Invoice.cs', 'Billing/Order.cs'),
    );
  });

  it('a namespace holding only nested namespaces links nothing and is not unresolved', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'App/Use.cs': 'using Acme;\npublic class Use {}\n',
    });
    expect(deps('App/Use.cs')).toEqual([]);
    expect(coverage()?.resolution).toMatchObject({
      unresolvedInternal: 0,
      external: 0,
    });
  });

  it('a file never depends on itself through its own namespace', async () => {
    const { deps, coverage } = await graphOf({
      'Solo/Only.cs':
        'using Acme.Solo;\nnamespace Acme.Solo;\npublic class Only {}\n',
    });
    expect(deps('Solo/Only.cs')).toEqual([]);
    expect(coverage()?.resolution?.unresolvedInternal).toBe(0);
  });
});

describe('CSHARP_IMPORT_RESOLVER — using static and aliases', () => {
  it('`using static N.T` links the file declaring public type T, not the rest of N', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'App/Calc.cs': 'using static Acme.Util.MathX;\npublic class Calc {}\n',
    });
    expect(deps('App/Calc.cs')).toEqual(at('Util/MathX.cs'));
    expect(coverage()?.approximations ?? []).not.toContain(
      'csharp:namespace-edges',
    );
  });

  it('`using static` of a type not known publicly links its namespace files', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'App/Tick.cs': 'using static Acme.Util.Clock;\npublic class Tick {}\n',
    });
    expect(deps('App/Tick.cs')).toEqual(at('Util/Clock.cs', 'Util/MathX.cs'));
    expect(coverage()?.approximations).toContain('csharp:namespace-edges');
  });

  it('an alias links its target: a namespace, a type, or a generic type', async () => {
    const { deps } = await graphOf({
      ...BILLING,
      'App/Aliases.cs': [
        'using B = Acme.Billing;',
        'using Inv = Acme.Billing.Invoice;',
        'using M = Acme.Util.MathX<int>;',
        'public class Aliases {}',
        '',
      ].join('\n'),
    });
    expect(deps('App/Aliases.cs')).toEqual(
      at('Billing/Invoice.cs', 'Billing/Order.cs', 'Util/MathX.cs'),
    );
  });
});

describe('CSHARP_IMPORT_RESOLVER — global using per project', () => {
  const PROJECT = '<Project Sdk="Microsoft.NET.Sdk"></Project>\n';

  it('applies to every file of the declaring project, and to no other project', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'Billing/Billing.csproj': PROJECT,
      'Util/Util.csproj': PROJECT,
      'App/App.csproj': PROJECT,
      'App/GlobalUsings.cs': 'global using Acme.Billing;\n',
      'App/Program.cs': 'namespace Acme.App;\npublic class Program {}\n',
      'App/Sub/Deeper.cs': 'namespace Acme.App.Sub;\npublic class Deeper {}\n',
      'Tool/Tool.csproj': PROJECT,
      'Tool/Other.cs': 'namespace Acme.Tool;\npublic class Other {}\n',
    });
    const billing = at('Billing/Invoice.cs', 'Billing/Order.cs');
    expect(deps('App/GlobalUsings.cs')).toEqual(billing);
    expect(deps('App/Program.cs')).toEqual(billing);
    expect(deps('App/Sub/Deeper.cs')).toEqual(billing);
    expect(deps('Tool/Other.cs')).toEqual([]);
    // Tallied once, where it is declared; the context knows every project.
    expect(coverage()?.resolution).toMatchObject({
      unresolvedInternal: 0,
      external: 0,
      context: 'complete',
    });
  });

  it('`global using static` and a global alias resolve like their plain forms', async () => {
    const { deps } = await graphOf({
      ...BILLING,
      'App/App.csproj': PROJECT,
      'App/GlobalUsings.cs':
        'global using static Acme.Util.MathX;\nglobal using Inv = Acme.Billing.Invoice;\n',
      'App/Program.cs': 'public class Program {}\n',
    });
    expect(deps('App/Program.cs')).toEqual(
      at('Billing/Invoice.cs', 'Util/MathX.cs'),
    );
  });

  it('a .csproj `<Using Include>` reaches every file of its project, tallied once', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'App/App.csproj': [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <ItemGroup>',
        '    <Using Include="Acme.Billing" />',
        '    <Using Include="Acme.Util.MathX" Static="true" />',
        '    <Using Include="Contoso.Unknown" />',
        '  </ItemGroup>',
        '</Project>',
        '',
      ].join('\n'),
      'App/Program.cs': 'public class Program {}\n',
      'App/Report.cs': 'public class Report {}\n',
    });
    const expected = at(
      'Billing/Invoice.cs',
      'Billing/Order.cs',
      'Util/MathX.cs',
    );
    expect(deps('App/Program.cs')).toEqual(expected);
    expect(deps('App/Report.cs')).toEqual(expected);
    // The unproven namespace counts once, not once per file, and it keeps
    // the answer from reading clean.
    const report = coverage();
    expect(report?.resolution).toMatchObject({
      external: 1,
      context: 'partial',
    });
    expect(isCleanAnswer(report!)).toBe(false);
  });

  it('the nearest Directory.Build.props applies its Using items to every project below it', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'Directory.Build.props':
        '<Project>\n  <ItemGroup>\n    <Using Include="Acme.Billing" />\n  </ItemGroup>\n</Project>\n',
      // Every file is in a project: no root group, nothing guessed.
      'Billing/Billing.csproj': PROJECT,
      'Util/Util.csproj': PROJECT,
      'src/App/App.csproj': PROJECT,
      'src/App/Program.cs': 'public class Program {}\n',
    });
    expect(deps('src/App/Program.cs')).toEqual(
      at('Billing/Invoice.cs', 'Billing/Order.cs'),
    );
    expect(coverage()?.resolution?.context).toBe('complete');
  });

  it('an MSBuild Import that is not followed is disclosed', async () => {
    const { coverage } = await graphOf({
      'App/App.csproj':
        '<Project Sdk="Microsoft.NET.Sdk">\n  <Import Project="../shared.props" />\n</Project>\n',
      'App/Program.cs': 'using System;\npublic class Program {}\n',
    });
    expect(coverage()?.resolution?.context).toBe('partial');
  });

  it('with no .csproj, the whole root is the project, and that guess is disclosed', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'App/GlobalUsings.cs': 'global using Acme.Billing;\n',
      'App/Program.cs': 'public class Program {}\n',
    });
    expect(deps('App/Program.cs')).toEqual(
      at('Billing/Invoice.cs', 'Billing/Order.cs'),
    );
    const report = coverage();
    expect(report?.resolution?.context).toBe('partial');
    expect(isCleanAnswer(report!)).toBe(false);
  });

  it('a project directory that cannot be listed makes the global using a disclosed guess', async () => {
    fs.mkdirSync(path.join(root, 'App'), { recursive: true });
    fs.writeFileSync(path.join(root, 'App/App.csproj'), PROJECT);
    const facts = (rel: string, imports: CodeInsights['imports']) => ({
      path: `${root}/${rel}`,
      language: 'csharp' as const,
      imports,
      exports: [],
    });
    const ctx = await buildResolverContext({
      root,
      knownFiles: at('App/GlobalUsings.cs', 'App/Program.cs'),
      parsedFiles: [
        facts('App/GlobalUsings.cs', [
          { source: 'Acme.Billing', kind: 'global' },
        ]),
        facts('App/Program.cs', []),
      ],
      isCurrent: () => true,
      fileSystem: {
        ...NODE_MANIFEST_FILE_SYSTEM,
        readdir: async (dir) => {
          if (dir === `${root}/App`) throw new Error('EACCES');
          return NODE_MANIFEST_FILE_SYSTEM.readdir(dir);
        },
      },
    });
    expect(ctx?.gaps).toContain('csharp-project-unknown');
  });
});

describe('CSHARP_IMPORT_RESOLVER — names no workspace file declares', () => {
  it('framework namespaces and referenced packages are proven external', async () => {
    const { coverage } = await graphOf({
      'App/App.csproj': [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <!-- <PackageReference Include="Commented.Out" /> -->',
        '  <ItemGroup>',
        '    <PackageReference Include="newtonsoft.json" Version="13.0.3" />',
        '  </ItemGroup>',
        '</Project>',
        '',
      ].join('\n'),
      'App/Program.cs': [
        'using System.Text;',
        'using Microsoft.Extensions.Logging;',
        'using Newtonsoft.Json.Linq;',
        'using static System.Math;',
        'public class Program {}',
        '',
      ].join('\n'),
    });
    expect(coverage()?.resolution).toMatchObject({
      external: 4,
      unresolvedInternal: 0,
      context: 'complete',
    });
  });

  it('an unproven namespace is external only as far as the context knows: partial, not clean', async () => {
    const { coverage } = await graphOf({
      'App/App.csproj': [
        '<Project Sdk="Microsoft.NET.Sdk">',
        '  <ItemGroup>',
        '    <ProjectReference Include="../Contoso.Lib/Contoso.Lib.csproj" />',
        '    <PackageReference Include="Commented.Out" />',
        '  </ItemGroup>',
        '</Project>',
        '',
      ].join('\n'),
      'App/Program.cs': 'using Contoso.Lib;\npublic class Program {}\n',
    });
    const report = coverage();
    expect(report?.resolution).toMatchObject({
      external: 1,
      context: 'partial',
    });
    expect(isCleanAnswer(report!)).toBe(false);
  });

  it('a missing namespace under a workspace root namespace is unresolved-internal', async () => {
    const { coverage } = await graphOf({
      ...BILLING,
      'App/Program.cs': 'using Acme.Missing;\npublic class Program {}\n',
    });
    const report = coverage();
    expect(report?.resolution?.unresolvedInternal).toBe(1);
    expect(isCleanAnswer(report!)).toBe(false);
  });

  it('a .csproj that is not an MSBuild project is a gap, not proof', async () => {
    const { coverage } = await graphOf({
      'App/App.csproj': 'not xml at all\n',
      'App/Program.cs': 'using System;\npublic class Program {}\n',
    });
    expect(coverage()?.resolution?.context).toBe('partial');
  });
});

describe('CSHARP_IMPORT_RESOLVER — per-import bound', () => {
  it('a namespace declared by 300 files links the first 200 and counts truncatedImports', async () => {
    const files: string[] = [];
    const insights = new Map<string, Partial<CodeInsights>>();
    for (let i = 0; i < 300; i++) {
      const rel = `Big/F${String(i).padStart(3, '0')}.cs`;
      files.push(rel);
      insights.set(`${root}/${rel}`, {
        imports: [],
        declarations: [
          { kind: 'namespace', name: 'Acme.Big', startLine: 0, endLine: 0 },
        ],
      });
    }
    insights.set(`${root}/App/Use.cs`, {
      imports: [{ source: 'Acme.Big', kind: 'module', scopePath: [] }],
    });
    const stub = {
      analyzeSource: jest.fn(async (_c: string, _l: string, p: string) =>
        Result.ok({
          functions: [],
          classes: [],
          imports: [],
          exports: [],
          ...insights.get(p),
        } as CodeInsights),
      ),
    } as unknown as AstAnalysisService;
    const svc = new DependencyGraphService(
      stub,
      { readFile: jest.fn(async () => '') } as unknown as FileSystemService,
      logger,
    );
    await svc.buildGraph(at(...files, 'App/Use.cs'), root);
    const deps = [...svc.getDependencies(`${root}/App/Use.cs`)].sort();
    expect(deps).toEqual(at(...files.slice(0, 200)));
    const report = svc.getCoverageReport(root)?.languages;
    expect(report?.resolution?.truncatedImports).toBe(1);
    expect(isCleanAnswer(report!)).toBe(false);
  });
});

describe('readMsbuildItems', () => {
  it('reads package ids and Using items, skipping comments and property-built values', () => {
    expect(
      readMsbuildItems(
        [
          '<Project Sdk="Microsoft.NET.Sdk">',
          '  <!-- <PackageReference Include="Hidden" /> -->',
          "  <PackageReference Include='Serilog; Serilog.Sinks.Console' />",
          '  <GlobalPackageReference Include="Nerdbank.GitVersioning" />',
          '  <PackageReference Include="$(Generated)" />',
          '  <PackageReference Update="OnlyUpdated" />',
          '  <ProjectReference Include="../Lib/Lib.csproj" />',
          '  <Using Include="Acme.Billing" />',
          '  <Using Include="Acme.Util.MathX" Static="true" />',
          '  <Using Include="Acme.Billing.Invoice" Alias="Inv" />',
          '  <Using Remove="System.Linq" />',
          '</Project>',
        ].join('\n'),
      ),
    ).toEqual({
      packages: ['Serilog', 'Serilog.Sinks.Console', 'Nerdbank.GitVersioning'],
      usings: [
        { name: 'Acme.Billing', isStatic: false },
        { name: 'Acme.Util.MathX', isStatic: true },
        { name: 'Acme.Billing.Invoice', isStatic: false, alias: 'Inv' },
      ],
      importsOther: false,
      unevaluatedUsings: false,
    });
  });

  it('notes an Import it does not follow', () => {
    expect(
      readMsbuildItems(
        '<Project>\n  <Import Project="../common.props" />\n</Project>\n',
      )?.importsOther,
    ).toBe(true);
  });

  it('is undefined for text that is not an MSBuild project', () => {
    expect(readMsbuildItems('{"not": "xml"}')).toBeUndefined();
  });
});

// Closing reviews of Batch 34 (lane G2): R34G-01, R34G-02, R34G-04, R34C-01.
describe('CSHARP_IMPORT_RESOLVER — closing-review fixes', () => {
  const PROJECT = '<Project Sdk="Microsoft.NET.Sdk"></Project>\n';
  const PROPS_USING_BILLING =
    '<Project>\n  <ItemGroup>\n    <Using Include="Acme.Billing" />\n  </ItemGroup>\n</Project>\n';

  /** A resolver context over hand-made C# facts (no parse). */
  async function contextOf(
    facts: ReadonlyArray<{
      rel: string;
      imports?: CodeInsights['imports'];
      exports?: CodeInsights['exports'];
      declarations?: CodeInsights['declarations'];
    }>,
  ) {
    const ctx = await buildResolverContext({
      root,
      knownFiles: facts.map((f) => `${root}/${f.rel}`),
      parsedFiles: facts.map((f) => ({
        path: `${root}/${f.rel}`,
        language: 'csharp' as const,
        imports: f.imports ?? [],
        exports: f.exports ?? [],
        ...(f.declarations !== undefined
          ? { declarations: f.declarations }
          : {}),
      })),
      isCurrent: () => true,
    });
    if (ctx === undefined) throw new Error('context superseded');
    return ctx;
  }

  it('R34G-01: with no .csproj, Directory.Build.props usings reach root-group files, and the guess is disclosed', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'Directory.Build.props': PROPS_USING_BILLING,
      'App/Program.cs': 'public class Program {}\n',
    });
    expect(deps('App/Program.cs')).toEqual(
      at('Billing/Invoice.cs', 'Billing/Order.cs'),
    );
    const report = coverage();
    expect(report?.resolution?.context).toBe('partial');
    expect(isCleanAnswer(report!)).toBe(false);
    const ctx = await contextOf([
      {
        rel: 'Billing/Invoice.cs',
        declarations: [
          { kind: 'namespace', name: 'Acme.Billing', startLine: 0, endLine: 0 },
        ],
      },
      { rel: 'App/Program.cs', declarations: [] },
    ]);
    expect(ctx.gaps).toContain('csharp-project-unknown');
    expect(
      CSHARP_IMPORT_RESOLVER.implicitImports?.(`${root}/App/Program.cs`, ctx),
    ).toEqual([
      {
        imp: expect.objectContaining({
          source: 'Acme.Billing',
          kind: 'global',
        }),
        declaredOutsideGraph: true,
      },
    ]);
  });

  it('R34G-01: in a mixed tree, the props usings reach both the project and the files outside it', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'Directory.Build.props': PROPS_USING_BILLING,
      'src/Lib/Lib.csproj': PROJECT,
      'src/Lib/Widget.cs': 'namespace Acme.Lib;\npublic class Widget {}\n',
      'Tools/Script.cs': 'public class Script {}\n',
    });
    const billing = at('Billing/Invoice.cs', 'Billing/Order.cs');
    expect(deps('src/Lib/Widget.cs')).toEqual(billing);
    expect(deps('Tools/Script.cs')).toEqual(billing);
    expect(coverage()?.resolution?.context).toBe('partial');
  });

  it('R34G-01: a root-group global using still reaches every root-group file, not the projects', async () => {
    const { deps } = await graphOf({
      ...BILLING,
      'Tools/GlobalUsings.cs': 'global using Acme.Billing;\n',
      'Tools/Script.cs': 'public class Script {}\n',
      'src/Lib/Lib.csproj': PROJECT,
      'src/Lib/Widget.cs': 'namespace Acme.Lib;\npublic class Widget {}\n',
    });
    expect(deps('Tools/Script.cs')).toEqual(
      at('Billing/Invoice.cs', 'Billing/Order.cs'),
    );
    expect(deps('src/Lib/Widget.cs')).toEqual([]);
  });

  it('R34G-02: a property-built <Using> value is disclosed, not skipped silently', async () => {
    expect(
      readMsbuildItems(
        '<Project>\n  <Using Include="$(RootNamespace).Models" />\n</Project>\n',
      ),
    ).toMatchObject({ usings: [], unevaluatedUsings: true });
    const { coverage } = await graphOf({
      ...BILLING,
      'App/App.csproj':
        '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <Using Include="$(RootNamespace).Models" />\n  </ItemGroup>\n</Project>\n',
      'App/Program.cs': 'namespace Acme.App;\npublic class Program {}\n',
    });
    const report = coverage();
    expect(report?.resolution?.context).toBe('partial');
    expect(isCleanAnswer(report!)).toBe(false);
    const ctx = await contextOf([{ rel: 'App/Program.cs', declarations: [] }]);
    expect(ctx.gaps).toContain('msbuild-using-not-evaluated');
  });

  it('R34G-04: a type whose file has no extracted declarations is filed nowhere', async () => {
    const ctx = await contextOf([
      {
        rel: 'Util/MathX.cs',
        exports: [{ name: 'MathX', kind: 'class' }],
      },
      { rel: 'App/Calc.cs', declarations: [] },
    ]);
    const resolution = CSHARP_IMPORT_RESOLVER.resolve(
      { source: 'MathX', kind: 'static', isStatic: true, scopePath: [] },
      `${root}/App/Calc.cs`,
      ctx,
    );
    expect(resolution.targets).toEqual([]);
  });

  it('R34G-04: a type of the global namespace links with the approximation, never as a precise file edge', async () => {
    const ctx = await contextOf([
      {
        rel: 'Util/MathX.cs',
        exports: [{ name: 'MathX', kind: 'class' }],
        declarations: [],
      },
      { rel: 'App/Calc.cs', declarations: [] },
    ]);
    expect(
      CSHARP_IMPORT_RESOLVER.resolve(
        { source: 'MathX', kind: 'static', isStatic: true, scopePath: [] },
        `${root}/App/Calc.cs`,
        ctx,
      ),
    ).toEqual({
      kind: 'namespace',
      targets: at('Util/MathX.cs'),
      approximation: 'csharp:namespace-edges',
    });
  });

  it('R34C-01: a missing manifest using shared by two files is tallied once', async () => {
    const { deps, coverage } = await graphOf({
      ...BILLING,
      'App/App.csproj':
        '<Project Sdk="Microsoft.NET.Sdk">\n  <ItemGroup>\n    <Using Include="Acme.Missing" />\n  </ItemGroup>\n</Project>\n',
      'App/Program.cs': 'public class Program {}\n',
      'App/Report.cs': 'public class Report {}\n',
    });
    expect(deps('App/Program.cs')).toEqual([]);
    expect(coverage()?.resolution).toMatchObject({
      unresolvedInternal: 1,
      external: 0,
    });
  });
});
