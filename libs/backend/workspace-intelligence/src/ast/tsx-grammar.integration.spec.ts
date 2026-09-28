/**
 * TSX tree-sitter query set — real-grammar integration test (Batch 29b).
 *
 * Loads the shipped `tree-sitter-tsx.wasm` (@vscode/tree-sitter-wasm) and runs
 * the real `LANGUAGE_QUERIES_MAP.tsx` queries — the TypeScript query set —
 * against real TSX source. The TypeScript grammar rejects JSX (a `.tsx`
 * component parses as `recovered`); the TSX grammar is the TypeScript grammar
 * plus JSX, so the same node names must hit and the parse must be clean. A
 * query naming a node the TSX grammar lacks makes `queryMulti` fail, and a
 * node that silently matches nothing gives zero captures, so only the real
 * grammar proves the claim (C# precedent, `csharp-grammar.integration.spec.ts`).
 *
 * The shims are the ones that spec documents: `./wasm-bundle-dir` reads
 * `import.meta.url` (Jest's CJS runtime cannot parse it), and
 * `Language.load(path)` uses a dynamic import Jest's VM rejects, so the file
 * is read here and handed over as bytes.
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
import { TreeSitterParserService } from './tree-sitter-parser.service';
import type { CodeInsights } from './ast-analysis.interfaces';
import {
  EXTENSION_LANGUAGE_MAP,
  GRAMMAR_FILE_MAP,
  LANGUAGE_QUERIES_MAP,
} from './tree-sitter.config';
import {
  LANGUAGE_REGISTRY,
  classifyFileForCoverage,
  languageForExtension,
  supportedLanguagesFor,
} from './language-registry';

/**
 * Representative TSX: relative imports only (validate-deps scans spec text
 * for bare module specifiers), an exported interface and type, a function
 * component, an arrow component with a fragment and a self-closing element, a
 * generic arrow (`<T,>` — TSX-only spelling), a class component with a render
 * method, and a default export.
 */
const TSX_SOURCE = `import { Base, useTheme } from './base';
import * as styles from './styles';

export interface ButtonProps {
  label: string;
  onClick(): void;
}

export type Variant = 'primary' | 'secondary';

export function Button(props: ButtonProps) {
  const theme = useTheme();
  return <button className={styles.root} onClick={props.onClick}>{props.label}</button>;
}

export const Card = ({ title }: { title: string }) => {
  return (
    <>
      <h2>{title}</h2>
      <hr />
    </>
  );
};

export const identity = <T,>(value: T): T => value;

export class Legacy extends Base {
  render() {
    return <div>{this.props.children}</div>;
  }
}

export default Card;
`;

function silentLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

describe('TSX grammar integration (real tree-sitter WASM, Batch 29b)', () => {
  let parser: TreeSitterParserService;
  let analysis: AstAnalysisService;
  let insights: CodeInsights;

  beforeAll(async () => {
    parser = new TreeSitterParserService(silentLogger());
    analysis = new AstAnalysisService(silentLogger(), parser);
    const result = await analysis.analyzeSource(TSX_SOURCE, 'tsx', 'App.tsx');
    if (result.isErr()) {
      throw result.error ?? new Error('TSX analyzeSource failed');
    }
    if (!result.value) {
      throw new Error('TSX analyzeSource returned no insights');
    }
    insights = result.value;
  }, 60_000);

  afterAll(() => {
    parser?.dispose();
  });

  describe('language wiring', () => {
    it('.tsx maps to its own tsx id and the shipped TSX grammar', () => {
      expect(EXTENSION_LANGUAGE_MAP['.tsx']).toBe('tsx');
      expect(EXTENSION_LANGUAGE_MAP['.ts']).toBe('typescript');
      expect(GRAMMAR_FILE_MAP.tsx).toBe('tree-sitter-tsx.wasm');
      expect(languageForExtension('.TSX')).toBe('tsx');
    });

    it('uses the TypeScript query set unchanged (the TSX grammar is TypeScript plus JSX)', () => {
      expect(LANGUAGE_QUERIES_MAP.tsx).toEqual(LANGUAGE_QUERIES_MAP.typescript);
    });

    it('grants parse, outline, codeIndex and enrichSummary to tsx in the registry', () => {
      const entry = LANGUAGE_REGISTRY.tsx;
      expect(entry.extensions).toEqual(['.tsx']);
      expect(entry.grammarFile).toBe('tree-sitter-tsx.wasm');
      expect(entry.capabilities).toMatchObject({
        parse: true,
        outline: true,
        enrichSummary: true,
        codeIndex: true,
      });
      for (const capability of [
        'parse',
        'outline',
        'enrichSummary',
        'codeIndex',
      ] as const) {
        expect(supportedLanguagesFor(capability)).toContain('tsx');
        expect(classifyFileForCoverage('/ws/src/App.tsx', capability)).toBe(
          'eligible',
        );
      }
    });

    it('does not claim the Electron index-free definition fallback, which refuses .tsx', () => {
      expect(LANGUAGE_REGISTRY.tsx.capabilities.definitionFallback).toBe(false);
      expect(
        classifyFileForCoverage('/ws/src/App.tsx', 'definitionFallback'),
      ).toBe('unsupported');
    });
  });

  describe('parse quality', () => {
    it('parses JSX cleanly (the TypeScript grammar would recover)', () => {
      expect(insights.parseStatus).toBe('ok');
      expect(insights.errorNodeCount).toBe(0);
    });

    it('the same source under the TypeScript grammar is a recovered parse (contrast)', async () => {
      const asTypescript = await analysis.analyzeSource(
        TSX_SOURCE,
        'typescript',
        'App.tsx',
      );
      expect(asTypescript.isOk()).toBe(true);
      expect(asTypescript.value?.parseStatus).toBe('recovered');
    });
  });

  describe('queries hit the right nodes', () => {
    it('captures function and arrow components, the generic arrow and the render method', () => {
      const names = insights.functions.map((f) => f.name);
      expect(names).toEqual(
        expect.arrayContaining(['Button', 'Card', 'identity']),
      );
      // A JSX-returning class method is captured like any other method.
      expect(names).toContain('render');
    });

    it('captures the class component', () => {
      expect(insights.classes.map((c) => c.name)).toContain('Legacy');
    });

    it('captures relative imports exactly as the TypeScript grammar does', async () => {
      expect(new Set(insights.imports.map((i) => i.source))).toEqual(
        new Set(['./base', './styles']),
      );
      // The import lines hold no JSX, so the TypeScript grammar parses them
      // cleanly: the TSX extraction must be identical, entry for entry.
      const importLines = TSX_SOURCE.split('\n').slice(0, 2).join('\n');
      const asTypescript = await analysis.analyzeSource(
        importLines,
        'typescript',
        'imports.ts',
      );
      expect(asTypescript.value?.parseStatus).toBe('ok');
      expect(insights.imports).toEqual(asTypescript.value?.imports);
    });

    it('captures every export kind, TypeScript-only ones included', () => {
      const byName = new Map(
        (insights.exports ?? []).map((e) => [e.name, e.kind] as const),
      );
      expect(byName.get('ButtonProps')).toBe('interface');
      expect(byName.get('Variant')).toBe('type');
      expect(byName.get('Button')).toBe('function');
      expect(byName.get('Card')).toBe('variable');
      expect(byName.get('identity')).toBe('variable');
      expect(byName.get('Legacy')).toBe('class');
      expect(byName.has('default')).toBe(true);
      expect(insights.unextractedExports).toBeUndefined();
    });
  });
});
