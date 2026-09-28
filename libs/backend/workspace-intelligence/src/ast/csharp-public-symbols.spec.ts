/**
 * C# public symbols (TASK_2026_559 Batch 34 `publicSymbols`) on the real
 * `tree-sitter-c-sharp.wasm` grammar: the export query's captures, decoded
 * by `csharp-public-symbols.ts` through `AstAnalysisService.analyzeSource`.
 * The two shims are the ones `csharp-grammar.integration.spec.ts` explains.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';

jest.mock('./wasm-bundle-dir', () => {
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

import { AstAnalysisService } from './ast-analysis.service';
import type { CodeInsights } from './ast-analysis.interfaces';
import { TreeSitterParserService } from './tree-sitter-parser.service';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

let parser: TreeSitterParserService;
let analysis: AstAnalysisService;

beforeAll(async () => {
  parser = new TreeSitterParserService(logger);
  const init = await parser.initialize();
  if (init.isErr()) throw init.error ?? new Error('tree-sitter init failed');
  analysis = new AstAnalysisService(logger, parser);
}, 60_000);

afterAll(() => parser.dispose());

async function analyse(source: string): Promise<CodeInsights> {
  const result = await analysis.analyzeSource(source, 'csharp', '/ws/A.cs');
  if (result.isErr()) throw result.error ?? new Error('analysis failed');
  return result.unwrap();
}

async function exported(source: string): Promise<string[]> {
  return ((await analyse(source)).exports ?? []).map(
    (e) => `${e.kind}:${e.name}`,
  );
}

describe('C# public symbols (Batch 34)', () => {
  it('lists public types and the public members of public types, never a non-public one', async () => {
    const names = await exported(
      [
        'namespace Acme.Billing;',
        'public class Invoice {',
        '  public int Total { get; }',
        '  public const int Limit = 3;',
        '  public int A, B;',
        '  public event System.Action Changed;',
        '  public void Send() {}',
        '  protected void Audit() {}',
        '  internal void Hidden() {}',
        '  private int _count;',
        '  void Implicit() {}',
        '  public class Line { public void Render() {} }',
        '  private class Secret { public void Leak() {} }',
        '}',
        'internal class Helper { public void Run() {} }',
        'class DefaultInternal {}',
        'public interface IStore { void Save(); private void Own() {} }',
        'public enum State { Draft }',
        'public record struct Money(decimal Amount);',
        'public delegate void Handler(int x);',
        'public static class Extensions { public static int Net(this Invoice i) => 0; }',
      ].join('\n'),
    );
    expect(names).toEqual([
      'class:Invoice',
      'variable:Total',
      'variable:Limit',
      'variable:A',
      'variable:B',
      'variable:Changed',
      'function:Send',
      'class:Line',
      'function:Render',
      'interface:IStore',
      'function:Save',
      'enum:State',
      'class:Money',
      'type:Handler',
      'class:Extensions',
      'function:Net',
    ]);
  });

  it('reads block namespaces, nested ones included, like file-scoped ones', async () => {
    const names = await exported(
      'namespace A { namespace B.C { public class K { public int P { get; } } } }\n',
    );
    expect(names).toEqual(['class:K', 'variable:P']);
  });

  it('discloses a partial part with no access modifier instead of dropping it', async () => {
    const insights = await analyse(
      [
        'namespace Acme;',
        'partial class Invoice { public void Send() {} }',
        'public partial class Order { public void Ship() {} }',
      ].join('\n'),
    );
    expect((insights.exports ?? []).map((e) => e.name)).toEqual([
      'Order',
      'Ship',
    ]);
    expect(insights.unextractedExports).toEqual([
      expect.stringMatching(/^line 2: partial class Invoice/),
    ]);
  });

  it('discloses a declaration whose modifiers the parser could not read', async () => {
    const insights = await analyse(
      ['public', '#if DEBUG', 'static', '#endif', 'class Weird {}'].join('\n'),
    );
    expect(insights.exports).toBeUndefined();
    expect(insights.unextractedExports).toHaveLength(1);
  });

  it('a file with no public declaration has no exports and nothing undisclosed', async () => {
    const insights = await analyse(
      'namespace Acme;\ninternal class A { public void B() {} }\n',
    );
    expect(insights.exports).toBeUndefined();
    expect(insights.unextractedExports).toBeUndefined();
  });
});
