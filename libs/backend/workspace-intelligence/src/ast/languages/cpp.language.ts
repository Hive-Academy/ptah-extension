/**
 * C++ language module (Batch 31). C++ sources and C sources (`.c`, `.h`)
 * parse with the shipped `tree-sitter-cpp.wasm` (@vscode/tree-sitter-wasm
 * 0.3.1); there is no separate C grammar (User Decision 19). An answer that
 * analysed a `.c`/`.h` file discloses the `c:parsed-as-cpp` approximation,
 * and valid C the C++ grammar cannot parse (a variable named `new` or
 * `class`, an `extern "C"` block split across `#ifdef`s) is reported as a
 * parse failure, never as a clean answer. Every node and field name below is
 * proven against that grammar by `php-ruby-cpp-grammar.integration.spec.ts`.
 *
 * `exportQuery` is empty: non-`static` declaration extraction and include
 * edges (`publicSymbols`, `graphEdges`) belong to Batch 36, so this module
 * claims neither.
 */
import type { LanguageModule } from './types';

/** C sources parsed with the C++ grammar (`c:parsed-as-cpp`). */
export const C_EXTENSIONS_PARSED_AS_CPP: readonly string[] = ['.c', '.h'];

/**
 * Every function definition (free, member, out-of-line `Type::member`,
 * template, operator, conversion), whatever wraps its name: pointers
 * (`int ***f()`), references, parentheses (`int (f)(int)`), a returned
 * function pointer (`int (*f())(int)`) or any depth of scopes. The whole
 * declarator is captured and `cDeclaratorName` (`../c-declarator.ts`) walks
 * it to the declared name and the innermost parameter list; one it cannot
 * name is reported in `unextractedDeclarations`, never dropped (Batch 31 r1
 * R31-02). Prototypes without a body are not indexed (the plan lists
 * `function_definition` only); the outline still finds them by name.
 */
const CPP_FUNCTION_QUERY = `
(function_definition
  declarator: (_) @function.declarator) @function.declaration
`;

const TYPE_NAME = `[
    (type_identifier) @class.name
    (qualified_identifier name: (type_identifier) @class.name)
    (template_type name: (type_identifier) @class.name)
  ]`;

/**
 * Class, struct, union and enum definitions (with a body: `struct point p;`
 * uses a type, it does not declare one), and an anonymous struct, union or
 * enum named by its `typedef` (the C idiom `typedef struct { … } Point;`).
 */
const CPP_CLASS_QUERY = `
(class_specifier
  name: ${TYPE_NAME}
  body: (_)) @class.declaration

(struct_specifier
  name: ${TYPE_NAME}
  body: (_)) @class.declaration

(union_specifier
  name: ${TYPE_NAME}
  body: (_)) @class.declaration

(enum_specifier
  name: ${TYPE_NAME}
  body: (_)) @class.declaration

(type_definition
  type: [
    (struct_specifier !name body: (_))
    (union_specifier !name body: (_))
    (enum_specifier !name body: (_))
  ]
  declarator: (type_identifier) @class.name) @class.declaration
`;

/**
 * `#include` directives: a local include (`string_literal`) reports its path
 * without quotes, a system include (`system_lib_string`) keeps its angle
 * brackets, so the two stay distinguishable. An include through a macro
 * (`#include HEADER`) names no file and is not reported.
 */
const CPP_IMPORT_QUERY = `
(preproc_include
  path: [(string_literal) (system_lib_string)] @import.source)
`;

export const CPP_LANGUAGE: LanguageModule = {
  id: 'cpp',
  extensions: [
    '.cpp',
    '.cc',
    '.cxx',
    '.c++',
    '.hpp',
    '.hh',
    '.hxx',
    ...C_EXTENSIONS_PARSED_AS_CPP,
  ],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-cpp.wasm',
  queries: {
    functionQuery: CPP_FUNCTION_QUERY,
    classQuery: CPP_CLASS_QUERY,
    importQuery: CPP_IMPORT_QUERY,
    exportQuery: '',
  },
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: null,
    // The Electron index-free declaration scan has no C/C++ query.
    definitionFallback: false,
    syntaxDiagnostics: true,
  },
};
