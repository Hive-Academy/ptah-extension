/**
 * Python public symbols (TASK_2026_559 Batch 33 `publicSymbols`; review r1
 * R33-06), decoded from the `export.py_*` captures of the Python export
 * query (`languages/python.language.ts`) by `extractExportsFromMatches`.
 *
 * - A static `__all__` (one module-level `__all__ = [...]` or `(...)` of
 *   plain string literals, never changed elsewhere) is the public surface:
 *   every listed name is public, underscored or imported ones included, with
 *   the kind of its module-level definition when there is one.
 * - Without one: module-level definitions and assignments not starting with
 *   `_`; names re-exported by a redundant alias (`from m import X as X`,
 *   `import m as m`, the typing convention); and, in a package
 *   `__init__.py`, the names its module-level `from` imports bind.
 * - What cannot be read statically is disclosed as unextracted, never
 *   dropped silently: an `__all__` that is not such a literal or is changed
 *   (`+=`, `.extend(...)`, a second or nested assignment); a public binding
 *   made inside a module-level `if`/`try`; and, in an `__init__.py`, a star
 *   import or a `from` import inside a module-level `if`/`try`.
 */
import type { ExportInfo } from './ast-analysis.interfaces';
import type { GenericAstNode } from './ast.types';
import type { ExportRowRange } from './export-extraction';
import type { QueryCapture } from './tree-sitter-parser.service';

/** A module-level definition the query found, subject to the rules above. */
export interface PythonCandidate {
  readonly info: ExportInfo;
  readonly rows: ExportRowRange;
}

/** The Python-only captures of one file, by kind. */
export interface PythonCaptures {
  /** The value of a module-level `__all__ = ...`. */
  readonly all: QueryCapture[];
  /** Every assignment to `__all__`, at any depth. */
  readonly allSites: QueryCapture[];
  /** `__all__ += ...`, `__all__.extend(...)` and the like. */
  readonly allDynamic: QueryCapture[];
  /** A name bound inside a module-level `if`/`try`. */
  readonly conditional: QueryCapture[];
  /** A `from` import inside a module-level `if`/`try`. */
  readonly conditionalImports: QueryCapture[];
  /** A module-level import statement. */
  readonly imports: QueryCapture[];
}

export function emptyPythonCaptures(): PythonCaptures {
  return {
    all: [],
    allSites: [],
    allDynamic: [],
    conditional: [],
    conditionalImports: [],
    imports: [],
  };
}

/** Capture name → the bucket it goes to. */
export const PYTHON_CAPTURES: Readonly<Record<string, keyof PythonCaptures>> = {
  'export.py_all': 'all',
  'export.py_all_site': 'allSites',
  'export.py_all_dynamic': 'allDynamic',
  'export.py_conditional': 'conditional',
  'export.py_conditional_import': 'conditionalImports',
  'export.py_import': 'imports',
};

/** One name an import statement binds. */
interface ImportBinding {
  readonly local: string;
  /** `from m import X as X` / `import m as m`. */
  readonly redundantAlias: boolean;
  readonly fromImport: boolean;
  readonly capture: QueryCapture;
}

/** Apply the rules in the module comment. */
export function pythonPublicSymbols(
  candidates: readonly PythonCandidate[],
  captures: PythonCaptures,
  fileName: string | undefined,
): { exports: PythonCandidate[]; unextracted: QueryCapture[] } {
  const isPackageInit =
    fileName !== undefined && /(^|[\\/])__init__\.pyi?$/.test(fileName);
  const unextracted: QueryCapture[] = [];
  const bindings: ImportBinding[] = [];
  for (const capture of captures.imports) {
    const found = importBindings(capture);
    if (found === 'star') {
      if (isPackageInit) unextracted.push(capture);
    } else {
      bindings.push(...found);
    }
  }

  const staticNames =
    captures.all.length === 1 &&
    captures.allSites.length === 1 &&
    captures.allDynamic.length === 0
      ? literalNames(captures.all[0].node)
      : undefined;
  if (staticNames !== undefined) {
    const allRows = rowsOf(captures.all[0]);
    const exports = staticNames.map((name): PythonCandidate => {
      const defined = candidates.find((c) => c.info.name === name);
      return defined ?? { info: { name, kind: 'unknown' }, rows: allRows };
    });
    // Star imports no longer matter: `__all__` names every public name.
    return { exports: uniqueByName(exports), unextracted: [] };
  }
  const allUses = [
    ...captures.allSites,
    ...captures.allDynamic,
    ...captures.all,
  ];
  if (allUses.length > 0) unextracted.push(allUses[0]);

  const exports = candidates.filter((c) => !c.info.name.startsWith('_'));
  for (const binding of bindings) {
    if (binding.local.startsWith('_')) continue;
    if (binding.redundantAlias || (isPackageInit && binding.fromImport)) {
      exports.push({
        info: { name: binding.local, kind: 'unknown' },
        rows: rowsOf(binding.capture),
      });
    }
  }
  for (const capture of captures.conditional) {
    if (!capture.text.startsWith('_')) unextracted.push(capture);
  }
  if (isPackageInit) unextracted.push(...captures.conditionalImports);
  return { exports: uniqueByName(exports), unextracted };
}

/** The strings of a list or tuple of plain string literals, else `undefined`. */
function literalNames(value: GenericAstNode): string[] | undefined {
  const node =
    value.type === 'parenthesized_expression' ? namedChildren(value)[0] : value;
  if (node === undefined || (node.type !== 'list' && node.type !== 'tuple')) {
    return undefined;
  }
  const names: string[] = [];
  for (const element of namedChildren(node)) {
    const name = plainString(element);
    if (name === undefined) return undefined;
    names.push(name);
  }
  return names;
}

/** The value of `"x"` / `'x'` with no prefix, escape or interpolation. */
function plainString(node: GenericAstNode): string | undefined {
  if (node.type !== 'string') return undefined;
  const parts = namedChildren(node);
  const start = parts.find((p) => p.type === 'string_start');
  if (start === undefined || !/^["']+$/.test(start.text)) return undefined;
  if (
    parts.some(
      (p) =>
        p.type !== 'string_start' &&
        p.type !== 'string_end' &&
        p.type !== 'string_content',
    )
  ) {
    return undefined;
  }
  const content = parts.find((p) => p.type === 'string_content');
  if (content !== undefined && content.children.some((c) => c.isNamed)) {
    return undefined; // an escape sequence
  }
  return content?.text ?? '';
}

/** The names an import statement binds at module level, or `'star'`. */
function importBindings(capture: QueryCapture): ImportBinding[] | 'star' {
  const statement = capture.node;
  const parts = namedChildren(statement);
  if (statement.type === 'import_statement') {
    return parts.flatMap((part): ImportBinding[] => {
      if (part.type !== 'aliased_import') return [];
      const original = namedChildren(part).find(
        (c) => c.type === 'dotted_name',
      )?.text;
      const alias = namedChildren(part).find(
        (c) => c.type === 'identifier',
      )?.text;
      return alias === undefined
        ? []
        : [
            {
              local: alias,
              redundantAlias: alias === original,
              fromImport: false,
              capture,
            },
          ];
    });
  }
  const names = parts.slice(1);
  if (names.some((n) => n.type === 'wildcard_import')) return 'star';
  return names.flatMap((name): ImportBinding[] => {
    if (name.type === 'dotted_name') {
      return [
        { local: name.text, redundantAlias: false, fromImport: true, capture },
      ];
    }
    if (name.type !== 'aliased_import') return [];
    const original = namedChildren(name).find(
      (c) => c.type === 'dotted_name',
    )?.text;
    const alias = namedChildren(name).find(
      (c) => c.type === 'identifier',
    )?.text;
    return alias === undefined
      ? []
      : [
          {
            local: alias,
            redundantAlias: alias === original,
            fromImport: true,
            capture,
          },
        ];
  });
}

function uniqueByName(
  candidates: readonly PythonCandidate[],
): PythonCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.info.name)) return false;
    seen.add(c.info.name);
    return true;
  });
}

function rowsOf(capture: QueryCapture): ExportRowRange {
  return {
    startLine: capture.startPosition.row,
    endLine: capture.endPosition.row,
  };
}

function namedChildren(node: GenericAstNode): GenericAstNode[] {
  return node.children.filter((c) => c.isNamed && c.type !== 'comment');
}
