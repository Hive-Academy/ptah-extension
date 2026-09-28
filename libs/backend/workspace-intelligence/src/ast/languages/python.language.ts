/**
 * Python language module. Python has no export statements: its public
 * symbols are the module-level definitions (Batch 33).
 */
import type { GenericAstNode } from '../ast.types';
import { PYTHON_IMPORT_RESOLVER } from '../import-resolution/python-import-resolver';
import type { GraphEdgesCapability } from '../language-registry';
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

/** Every block a module-level `if`/`try` statement runs. */
const CONDITIONAL_BLOCKS = [
  '(if_statement consequence: (block BODY))',
  '(if_statement (elif_clause consequence: (block BODY)))',
  '(if_statement (else_clause body: (block BODY)))',
  '(try_statement body: (block BODY))',
  '(try_statement (except_clause (block BODY)))',
  '(try_statement (else_clause body: (block BODY)))',
  '(try_statement (finally_clause (block BODY)))',
];

/**
 * Public module symbols (Batch 33, `publicSymbols`; review r1 R33-06),
 * decoded by `python-public-symbols.ts` through `extractExportsFromMatches`:
 * - `@export.py_candidate` module-level functions and classes (decorated or
 *   not) and assigned names, public unless underscored or left out of a
 *   static `__all__`;
 * - `@export.py_all` / `py_all_site` / `py_all_dynamic`: `__all__` and every
 *   change to it;
 * - `@export.py_import`: module-level imports (re-exports);
 * - `@export.py_conditional` / `py_conditional_import`: bindings and `from`
 *   imports inside a module-level `if`/`try`, disclosed as unextracted.
 */
const PYTHON_EXPORT_QUERY = `
(module
  (function_definition name: (identifier) @export.func_name @export.py_candidate))
(module
  (decorated_definition
    definition: (function_definition name: (identifier) @export.func_name @export.py_candidate)))
(module
  (class_definition name: (identifier) @export.class_name @export.py_candidate))
(module
  (decorated_definition
    definition: (class_definition name: (identifier) @export.class_name @export.py_candidate)))
(module
  (expression_statement
    (assignment left: (identifier) @export.var_name @export.py_candidate)))
(module
  (expression_statement
    (assignment left: (pattern_list (identifier) @export.var_name @export.py_candidate))))

(module
  (expression_statement
    (assignment left: (identifier) @_all right: (_) @export.py_all))
  (#eq? @_all "__all__"))
((assignment left: (identifier) @_all) @export.py_all_site
  (#eq? @_all "__all__"))
((augmented_assignment left: (identifier) @_all) @export.py_all_dynamic
  (#eq? @_all "__all__"))
((call function: (attribute object: (identifier) @_all)) @export.py_all_dynamic
  (#eq? @_all "__all__"))

(module (import_from_statement) @export.py_import)
(module (import_statement) @export.py_import)
${CONDITIONAL_BLOCKS.map(
  (container) =>
    `(module ${container.replace(
      'BODY',
      `[(function_definition name: (identifier) @export.py_conditional)
      (class_definition name: (identifier) @export.py_conditional)
      (decorated_definition definition: (_ name: (identifier) @export.py_conditional))
      (expression_statement (assignment left: (identifier) @export.py_conditional))
      (import_from_statement) @export.py_conditional_import]`,
    )})`,
).join('\n')}
`;

/**
 * File edges through {@link PYTHON_IMPORT_RESOLVER}. Not reference-complete:
 * star imports and `importlib`/`__import__` reach names no edge records.
 */
const PYTHON_GRAPH_EDGES: GraphEdgesCapability = {
  granularity: 'file',
  referenceScopeComplete: false,
};

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

/** The `as` name of an `aliased_import`, or `null` for a plain name. */
function aliasOf(node: GenericAstNode): string | null {
  if (node.type !== 'aliased_import') return null;
  return namedChildren(node).find((c) => c.type === 'identifier')?.text ?? null;
}

/**
 * `import a, b.c as d` gives one import per module; `from m import x, y as z`
 * gives one import of `m` with every requested name under its original name
 * (`importedSymbols: ['x', 'y']`) and, when any is renamed, the local names
 * index for index (`importedSymbolAliases: [null, 'z']`); `from . import x`
 * / `from ..m import *` are relative with the dot count as `relativeLevel`.
 * `from __future__ import` is a compiler directive, not a dependency, and is
 * not matched.
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
  const aliases = wildcard ? [] : names.map(aliasOf);
  const symbols = {
    ...(importedSymbols.length > 0 ? { importedSymbols } : {}),
    ...(aliases.some((alias) => alias !== null)
      ? { importedSymbolAliases: aliases }
      : {}),
  };
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
    exportQuery: PYTHON_EXPORT_QUERY,
  },
  // Python declares no package or namespace in source (the directory is the
  // package), so there is no declaration query and `scopePath` is `[]`.
  extraction: { extractImports: extractPythonImports },
  importResolver: PYTHON_IMPORT_RESOLVER,
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: PYTHON_GRAPH_EDGES,
    definitionFallback: true,
    syntaxDiagnostics: true,
  },
};
