/**
 * Represents information about a function definition identified in the code.
 */
export interface FunctionInfo {
  /**
   * The name of the function.
   */
  name: string;
  /**
   * An array of parameter names for the function.
   */
  parameters: string[];
  /**
   * The starting line number (0-indexed).
   */
  startLine?: number;
  /**
   * The ending line number (0-indexed).
   */
  endLine?: number;
  /**
   * Whether this function is exported.
   */
  isExported?: boolean;
  /**
   * Whether this is an async function.
   */
  isAsync?: boolean;
}

/**
 * Represents information about a class definition identified in the code.
 */
export interface ClassInfo {
  /**
   * The name of the class.
   */
  name: string;
  /**
   * The starting line number (0-indexed).
   */
  startLine?: number;
  /**
   * The ending line number (0-indexed).
   */
  endLine?: number;
  /**
   * Whether this class is exported.
   */
  isExported?: boolean;
  /**
   * Methods defined in the class.
   */
  methods?: FunctionInfo[];
}

/**
 * How an import names its target (Batch 32a extraction contract). One kind per
 * import; when a statement has several traits the first of this precedence
 * wins: `global` > `static` > `relative` > `wildcard` > `alias` > `module`
 * (the lost trait stays visible: a relative or static wildcard carries
 * `importedSymbols: ['*']`, an aliased one carries `alias`, and every static
 * import carries `isStatic: true`, so C# `global using static` keeps it).
 * - `module`: an absolute module, package, namespace or path.
 * - `relative`: resolved against the importing file or scope
 *   (`relativeLevel` says how far up).
 * - `wildcard`: brings every public name of `source` into scope (Java
 *   `a.b.*`, Python `from a import *`, Rust `a::*`, Go dot import).
 * - `static`: members of a type (Java `import static`, C# `using static`).
 * - `alias`: the source itself is bound under `alias` (Python `import a as b`,
 *   C# `using A = N.T`, Rust `use a::b as c`, Go named import).
 * - `global`: C# `global using`, in scope for every file of the project.
 * - `mod-decl`: Rust `mod x;`, a module whose body lives in another file.
 * - `include-local` / `include-system`: C/C++ `#include "x"` / `<x>`.
 */
export type ImportKind =
  | 'module'
  | 'relative'
  | 'wildcard'
  | 'static'
  | 'alias'
  | 'global'
  | 'mod-decl'
  | 'include-local'
  | 'include-system';

/**
 * Represents information about an import statement identified in the code.
 *
 * `kind`, `relativeLevel`, `alias`, `line` and `scopePath` are the Batch 32a
 * extraction contract. They are present for every language whose module
 * defines `extraction` (`languages/types.ts`); TS/JS imports keep their
 * earlier shape byte for byte and carry none of them. A TS/JS re-export
 * (`export { X } from './a'`) is not an import: the module it loads is in
 * `CodeInsights.reExportSources` (and, when it names something, in an
 * `ExportInfo` with `isReExport` and `source`).
 */
export interface ImportInfo {
  /**
   * The module, package, namespace or path as written, unquoted
   * ('react', './utils', 'a.b', '..pkg.mod', 'crate::util', 'fmt'). A Rust
   * grouped `use` is split into one import per path; a wildcard's source is
   * the container (`a.b` for `import a.b.*`).
   */
  source: string;
  /**
   * The names requested from `source` under their original names: every name
   * of a Python `from a import b, c` (`['b', 'c']`), `['*']` for a wildcard.
   * Absent when the statement imports `source` itself.
   */
  importedSymbols?: string[];
  /**
   * The local name each entry of `importedSymbols` is bound to, index for
   * index: the `as` name of a renamed member, `null` for one that keeps its
   * own name (Python `from ..p import A as B, C` → `['B', null]`). Present
   * only when at least one requested name is renamed.
   */
  importedSymbolAliases?: Array<string | null>;
  /**
   * Whether this is a default import.
   */
  isDefault?: boolean;
  /**
   * Whether this is a namespace import (import * as X).
   */
  isNamespace?: boolean;
  /** How the import names its target; see {@link ImportKind}. */
  kind?: ImportKind;
  /**
   * `true` for every import of a type's static members (Java `import static`,
   * C# `using static`, including `global using static`, whose kind is
   * `global`): the target is a type, not a namespace or package.
   */
  isStatic?: true;
  /**
   * For `relative`: 1 is the importing file's own package or module, each
   * further level is one more up (Python `.` = 1, `..` = 2; Rust `self::` = 1,
   * `super::` = 2, `super::super::` = 3).
   */
  relativeLevel?: number;
  /** The local name `source` is bound to (`kind: 'alias'`, or a relative or wildcard import that also renames). */
  alias?: string;
  /** Line of the import statement (0-indexed, like `startLine`). */
  line?: number;
  /**
   * Names of the declarations (`CodeInsights.declarations`) enclosing the
   * import, outermost first, each as written in its own declaration (C#
   * `namespace A { namespace B.C { using X; } }` → `['A', 'B.C']`; Rust
   * `mod a { mod b { use self::x; } }` → `['a', 'b']`). A file-scoped
   * declaration (Java/Go `package`, C# `namespace N;`) encloses the rest of
   * the file. `[]` when nothing encloses the import.
   */
  scopePath?: string[];
}

/**
 * A package, namespace or module a file declares (Batch 32a). `name` is the
 * full name inside the file: nested C# namespaces concatenate
 * (`A.B.C`), nested Rust inline modules nest (`a::b`). A file-scoped
 * declaration ends at the end of the file.
 */
export interface DeclarationInfo {
  kind: 'package' | 'namespace' | 'module';
  name: string;
  /** 0-indexed, like `FunctionInfo.startLine`. */
  startLine: number;
  /** 0-indexed; the file's last line for a file-scoped declaration. */
  endLine: number;
}

/**
 * Represents information about an export statement identified in the code.
 */
export interface ExportInfo {
  /**
   * The name other modules import. A named declaration keeps its own name even
   * when it is the default export (`export default function f` → `f`); an
   * anonymous or expression default export is `default`; `export { a as b }`
   * is `b`; `export * as ns` is `ns`; a plain `export *` is `*`.
   */
  name: string;
  /**
   * What the export is. `unknown` means the statement names a binding without
   * declaring it (`export { a }`, `export default a`). `namespace` is a TS
   * `namespace` or an `export * as ns`; `wildcard` is a plain `export *`,
   * whose names are resolved in `source`, not here.
   */
  kind:
    | 'function'
    | 'class'
    | 'variable'
    | 'type'
    | 'interface'
    | 'enum'
    | 'namespace'
    | 'wildcard'
    | 'unknown';
  /**
   * Whether this is a default export.
   */
  isDefault?: boolean;
  /**
   * Whether this is a re-export from another module.
   */
  isReExport?: boolean;
  /**
   * The source module if this is a re-export.
   */
  source?: string;
  /**
   * The local (or, for a re-export, the source module's) name when it differs
   * from `name`: `a` for `export { a as b }` and for `export default a`.
   */
  localName?: string;
}

/**
 * Represents the structured code insights extracted from a single file's AST.
 */
export interface ParseQuality {
  /** Unknown is used for legacy ASTs that did not retain parser metadata. */
  parseStatus: 'ok' | 'recovered' | 'unknown';
  /** Saturates at 20; null means the original parse was not observed. */
  errorNodeCount: number | null;
  /** True means the count is a lower bound. */
  errorNodeCountCapped: boolean;
}

export interface CodeInsights extends Partial<ParseQuality> {
  /**
   * An array of identified function definitions.
   */
  functions: FunctionInfo[];
  /**
   * An array of identified class definitions.
   */
  classes: ClassInfo[];
  /**
   * An array of identified import statements.
   */
  imports: ImportInfo[];
  /**
   * An array of identified export statements.
   */
  exports?: ExportInfo[];
  /**
   * Export forms seen but not represented in `exports` (`line N: <source>`),
   * e.g. `exports[key] = v`. Present means `exports` may be incomplete.
   */
  unextractedExports?: string[];
  /**
   * Definitions seen but not represented in `functions` (`line N: <text>`):
   * a C/C++ declarator that names nothing the walker can read. Present means
   * `functions` may be incomplete (Batch 31 r1 R31-02).
   */
  unextractedDeclarations?: string[];
  /**
   * Every module a TS/JS re-export statement loads (`export { a } from './m'`,
   * `export * from './m'`, and the empty clause `export {} from './m'`, which
   * exports no name), as the string's value (escapes decoded), once each, in
   * source order. The dependency graph links each one like an import.
   * Absent when the file has none.
   */
  reExportSources?: string[];
  /**
   * Packages, namespaces and modules the file declares, in source order.
   * Present (possibly empty) only for a language whose module defines a
   * declaration query; absent means declarations were not extracted.
   */
  declarations?: DeclarationInfo[];
}
