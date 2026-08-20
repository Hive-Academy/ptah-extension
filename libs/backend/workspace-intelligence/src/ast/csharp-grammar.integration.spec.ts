/**
 * C# tree-sitter query set — real-grammar integration test.
 *
 * Unlike the other AST specs, this one deliberately does NOT mock
 * `web-tree-sitter`: it loads the actual `tree-sitter-c-sharp.wasm` grammar out
 * of node_modules and runs the real `LANGUAGE_QUERIES_MAP.csharp` queries
 * against real C# source.
 *
 * That is the whole point. A tree-sitter query naming a node or field that the
 * grammar does not have produces ZERO captures and NO error, so a mock-fed test
 * (which asserts the extraction layer, not the queries) would stay green while
 * C# indexing silently returned nothing. This spec is the only thing standing
 * between a typo in a query and a shipped no-op.
 *
 * Two shims are needed, and neither touches the grammar or the queries:
 *  - `./wasm-bundle-dir` is mocked because the real module reads
 *    `import.meta.url`, which Jest's CJS runtime cannot parse. The stub points
 *    the resolver at the same files `scripts/copy-wasm.js` copies.
 *  - `Language.load(path)` in the CJS build of web-tree-sitter reads its input
 *    with `await import('fs/promises')`, and Jest's VM rejects dynamic import
 *    without --experimental-vm-modules. The buffer overload takes no such path,
 *    so the shim reads the file itself and hands over the bytes.
 */

import 'reflect-metadata';
import { Logger } from '@ptah-extension/vscode-core';

jest.mock('./wasm-bundle-dir', () => {
  const nodePath = require('path');
  // The grammars ship in @vscode/tree-sitter-wasm; the runtime ships in
  // web-tree-sitter itself. copy-wasm.js merges both into one `wasm/` dir.
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
import { TreeSitterParserService } from './tree-sitter-parser.service';
import type { CodeInsights } from './ast-analysis.interfaces';

/**
 * Representative C# source: file-scoped namespace, several using forms
 * (plain, dotted, static, aliased), a positional record, a record struct, an
 * interface, an enum, a struct, a partial class split into two parts, a
 * constructor, an auto-property, an expression-bodied property, a generic
 * method, two local functions, a static extension class, and a block-scoped
 * namespace with a nested type.
 */
const CSHARP_SOURCE = `using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Alias = System.Text.StringBuilder;
using static System.Math;

namespace Acme.Billing;

public record InvoiceCreated(Guid Id, decimal Amount);

public record struct Money(decimal Amount, string Currency);

public interface IInvoiceStore
{
    Task<Invoice?> FindAsync(Guid id);
    int Count { get; }
}

public enum InvoiceState { Draft, Sent, Paid }

public struct LineItem
{
    public decimal Total() => 0m;
}

public partial class Invoice : IInvoiceStore
{
    private readonly ILogger _logger;

    public Guid Id { get; init; }
    public int Count => 0;

    public Invoice(ILogger logger)
    {
        _logger = logger;
    }

    public async Task<Invoice?> FindAsync(Guid id)
    {
        static int Local(int x) => x + 1;
        int Helper(int y)
        {
            return y;
        }
        return null;
    }

    public T Map<T>(Func<Invoice, T> selector) where T : class
    {
        return selector(this);
    }
}

public partial class Invoice
{
    public void Send() { }
}

public static class Extensions
{
    public static decimal Net(this Invoice i, decimal rate) => i.Amount * rate;
}

namespace Acme.Billing.Legacy
{
    internal class OldInvoice
    {
        public void Noop() { }
    }
}
`;

describe('C# grammar integration (real tree-sitter WASM)', () => {
  let parser: TreeSitterParserService;
  let insights: CodeInsights;

  beforeAll(async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      lifecycle: jest.fn(),
      dispose: jest.fn(),
    } as unknown as Logger;

    parser = new TreeSitterParserService(logger);
    const analysis = new AstAnalysisService(logger, parser);

    const result = await analysis.analyzeSource(
      CSHARP_SOURCE,
      'csharp',
      'Invoice.cs',
    );
    if (result.isErr()) {
      throw result.error ?? new Error('C# analyzeSource failed');
    }
    const value = result.value;
    if (!value) {
      throw new Error('C# analyzeSource returned no insights');
    }
    insights = value;
    // Loading five WASM grammars (C# alone is ~4.9 MB) is the slow part.
  }, 60_000);

  afterAll(() => {
    parser?.dispose();
  });

  describe('imports (using_directive)', () => {
    it('captures plain, dotted, static and aliased usings exactly once each', () => {
      expect(insights.imports.map((i) => i.source)).toEqual([
        'System',
        'System.Collections.Generic',
        'System.Threading.Tasks',
        'System.Text.StringBuilder',
        'System.Math',
      ]);
    });

    it('reports the alias as the imported symbol, not as a second source', () => {
      const aliased = insights.imports.find(
        (i) => i.source === 'System.Text.StringBuilder',
      );
      expect(aliased?.importedSymbols).toEqual(['Alias']);
      // The `!name` negation in the query exists to prevent exactly this.
      expect(insights.imports.map((i) => i.source)).not.toContain('Alias');
    });
  });

  describe('types (@class.*)', () => {
    it('captures classes, interfaces, structs, records and enums', () => {
      const names = insights.classes.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'InvoiceCreated', // record
          'Money', // record struct
          'IInvoiceStore', // interface
          'InvoiceState', // enum
          'LineItem', // struct
          'Invoice', // partial class
          'Extensions', // static class
          'OldInvoice', // nested-namespace class
        ]),
      );
    });

    it('captures both file-scoped and block-scoped namespaces', () => {
      const names = insights.classes.map((c) => c.name);
      expect(names).toContain('Acme.Billing');
      expect(names).toContain('Acme.Billing.Legacy');
    });

    it('emits one entry per part of a partial class (documented policy)', () => {
      const parts = insights.classes.filter((c) => c.name === 'Invoice');
      expect(parts).toHaveLength(2);
      // Distinct declaration sites, each with its own real line range.
      const startLines = parts.map((p) => p.startLine);
      expect(new Set(startLines).size).toBe(2);
    });

    it('reports line ranges that span the whole declaration', () => {
      const iface = insights.classes.find((c) => c.name === 'IInvoiceStore');
      expect(iface).toBeDefined();
      expect(iface?.endLine).toBeGreaterThan(iface?.startLine ?? 0);
    });
  });

  describe('members and functions (@method.* / @function.*)', () => {
    it('captures methods, including interface members and generic methods', () => {
      const names = insights.functions.map((f) => f.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'FindAsync', // interface member + implementation
          'Total', // expression-bodied struct method
          'Map', // generic method
          'Send', // second partial part
          'Net', // static extension method
          'Noop', // nested-namespace method
        ]),
      );
    });

    it('captures constructors under the declaring type name', () => {
      const ctor = insights.functions.find(
        (f) => f.name === 'Invoice' && f.parameters.length === 1,
      );
      expect(ctor).toBeDefined();
    });

    it('captures local functions declared inside a method body', () => {
      const names = insights.functions.map((f) => f.name);
      expect(names).toContain('Local');
      expect(names).toContain('Helper');
    });

    it('captures auto-properties and expression-bodied properties', () => {
      const names = insights.functions.map((f) => f.name);
      expect(names).toContain('Id');
      expect(names).toContain('Count');
    });

    it('keeps the interface declaration and its implementation as separate entries', () => {
      const findAsync = insights.functions.filter(
        (f) => f.name === 'FindAsync',
      );
      expect(findAsync).toHaveLength(2);
    });

    it('extracts parameters as C# type tokens, and splits inside generics', () => {
      // Documented limitation of the shared `extractParamsFromText`: it keeps
      // the first token of each comma-separated part, so C# yields parameter
      // TYPES rather than names, and a generic argument list is split on its
      // own comma. Pinned here so the behaviour is a known cost, not a
      // surprise — fixing it means making the shared extractor language-aware.
      const map = insights.functions.find((f) => f.name === 'Map');
      expect(map?.parameters).toEqual(['Func<Invoice', 'T>']);
      const net = insights.functions.find((f) => f.name === 'Net');
      expect(net?.parameters).toEqual(['this', 'decimal']);
    });

    it('leaves properties without parameters (they capture no param list)', () => {
      const id = insights.functions.find((f) => f.name === 'Id');
      expect(id?.parameters).toEqual([]);
    });
  });

  it('produces no exports — C# has no export statement', () => {
    expect(insights.exports).toBeUndefined();
  });
});
