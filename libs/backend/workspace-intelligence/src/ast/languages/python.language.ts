/** Python language module. Python has no export statements: `exportQuery` is empty. */
import type { GenericAstNode } from '../ast.types';
import type { ExtractedImport, LanguageModule } from './types';

/**
 * Python queries. Methods are plain function_definition nodes inside a class
 * body, so they are captured as functions too — consistent with Python's model.
 * Reuses the JS/TS capture names so the extraction layer is shared.
 */
const PYTHON_FUNCTION_QUERY = `
(function_definition
  name: (identifier) @function.name
  parameters: (parameters) @function.params) @function.declaration
`;

const PYTHON_CLASS_QUERY = `
(class_definition
  name: (identifier) @class.name) @class.declaration
`;

const PYTHON_IMPORT_QUERY = `
; import x / import x.y
(import_statement
  name: (dotted_name) @import.source)

; import x as y
(import_statement
  name: (aliased_import
    name: (dotted_name) @import.source))

; from x import a, b
(import_from_statement
  module_name: (dotted_name) @import.source
  name: (dotted_name) @import.named)

; Whole statements for the Batch 32a extraction contract (\`extractImports\`).
; The patterns above feed execute_code \`ast.queryImports\` unchanged.
(import_statement) @import.statement
(import_from_statement) @import.statement
`;

function namedChildren(node: GenericAstNode): GenericAstNode[] {
  return node.children.filter((c) => c.isNamed && c.type !== 'comment');
}

/** `a.b` of a `dotted_name`, or of the `name` of an `aliased_import`. */
function importedName(node: GenericAstNode): string {
  return node.type === 'aliased_import'
    ? (namedChildren(node).find((c) => c.type === 'dotted_name')?.text ??
        node.text)
    : node.text;
}

/**
 * `import a, b.c as d` gives one import per module; `from m import x, y as z`
 * gives one import of `m` with every requested name (a rename keeps the
 * original name, `y`); `from . import x` / `from ..m import *` are relative
 * with the dot count as `relativeLevel`. `from __future__ import` is a
 * compiler directive, not a dependency, and is not matched.
 */
function extractPythonImports(statement: GenericAstNode): ExtractedImport[] {
  const parts = namedChildren(statement);
  if (statement.type === 'import_statement') {
    return parts.map((part): ExtractedImport => {
      if (part.type !== 'aliased_import') {
        return { source: part.text, kind: 'module' };
      }
      const alias = namedChildren(part).find((c) => c.type === 'identifier');
      return {
        source: importedName(part),
        kind: 'alias',
        ...(alias ? { alias: alias.text } : {}),
      };
    });
  }
  const [moduleName, ...names] = parts;
  if (!moduleName) return [];
  const wildcard = names.some((n) => n.type === 'wildcard_import');
  const importedSymbols = wildcard ? ['*'] : names.map(importedName);
  const symbols = importedSymbols.length > 0 ? { importedSymbols } : {};
  if (moduleName.type === 'relative_import') {
    const prefix = namedChildren(moduleName).find(
      (c) => c.type === 'import_prefix',
    );
    return [
      {
        source: moduleName.text.replace(/\s+/g, ''),
        kind: 'relative',
        relativeLevel: (prefix?.text.match(/\./g) ?? []).length,
        ...symbols,
      },
    ];
  }
  return [
    {
      source: moduleName.text,
      kind: wildcard ? 'wildcard' : 'module',
      ...symbols,
    },
  ];
}

export const PYTHON_LANGUAGE: LanguageModule = {
  id: 'python',
  extensions: ['.py'],
  recognitionOnlyExtensions: ['.pyi', '.pyw'],
  grammarFile: 'tree-sitter-python.wasm',
  queries: {
    functionQuery: PYTHON_FUNCTION_QUERY,
    classQuery: PYTHON_CLASS_QUERY,
    importQuery: PYTHON_IMPORT_QUERY,
    exportQuery: '',
  },
  // Python declares no package or namespace in source (the directory is the
  // package), so there is no declaration query and `scopePath` is `[]`.
  extraction: { extractImports: extractPythonImports },
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: null,
    definitionFallback: true,
    syntaxDiagnostics: true,
  },
};
