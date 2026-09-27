/**
 * Rust language module (Batch 30). `.rs` parses with the shipped
 * `tree-sitter-rust.wasm` (@vscode/tree-sitter-wasm 0.3.1). Every node and
 * field name below is proven against that grammar by
 * `java-rust-grammar.integration.spec.ts`.
 *
 * `exportQuery` is empty: `pub` item extraction and module-graph edges
 * (`publicSymbols`, `graphEdges`) belong to Batch 35, so this module claims
 * neither.
 */
import type { GenericAstNode } from '../ast.types';
import type { ExtractedImport, LanguageModule } from './types';

/**
 * Every `fn` with a body, free or inside an `impl`/`trait` block. Bodiless
 * trait signatures (`function_signature_item`) are not indexed, as the plan's
 * query table lists only `function_item`.
 */
const RUST_FUNCTION_QUERY = `
(function_item
  name: (identifier) @function.name
  parameters: (parameters) @function.params) @function.declaration
`;

/**
 * Structs, enums and traits by name. An `impl` block has no name of its own:
 * it is indexed under the last segment of the type it implements, with the
 * path, generic arguments and one reference stripped (`impl Draw for Shape`,
 * `impl<T> Point<T>`, `impl nested::Foo`, `impl<T> Tr for path::Type<T>`,
 * `impl Tr for &'a mut m::Baz<'a>` give `Shape`, `Point`, `Foo`, `Type`,
 * `Baz`), so a search for a type finds its impl blocks too (Batch 30 r1
 * R30-04). Array, tuple, slice and `dyn` self types name no single type and
 * are not indexed as impl blocks; their functions still are.
 */
const RUST_CLASS_QUERY = `
(struct_item
  name: (type_identifier) @class.name) @class.declaration

(enum_item
  name: (type_identifier) @class.name) @class.declaration

(trait_item
  name: (type_identifier) @class.name) @class.declaration

(impl_item
  type: [
    (type_identifier) @class.name
    (scoped_type_identifier name: (type_identifier) @class.name)
    (generic_type
      type: [
        (type_identifier) @class.name
        (scoped_type_identifier name: (type_identifier) @class.name)
      ])
    (reference_type
      type: [
        (type_identifier) @class.name
        (scoped_type_identifier name: (type_identifier) @class.name)
        (generic_type
          type: [
            (type_identifier) @class.name
            (scoped_type_identifier name: (type_identifier) @class.name)
          ])
      ])
  ]) @class.declaration
`;

/**
 * The `@import.source` patterns feed execute_code `ast.queryImports`: `use`
 * trees whole (`std::collections::{HashMap, HashSet}`), an alias with its
 * path and the alias as the imported name, `mod x;` (a module declared in
 * another file) and `extern crate x;` by name. The `@import.statement`
 * patterns feed the Batch 32a extraction contract (`extractRustImports`),
 * which splits grouped trees; resolving `crate::`/`self::`/`super::` from
 * `scopePath` is Batch 35's work.
 */
const RUST_IMPORT_QUERY = `
(use_declaration
  argument: [
    (identifier)
    (scoped_identifier)
    (scoped_use_list)
    (use_list)
    (use_wildcard)
    (crate)
    (self)
    (super)
  ] @import.source)

(use_declaration
  argument: (use_as_clause
    path: (_) @import.source
    alias: (identifier) @import.named))

(mod_item
  !body
  name: (identifier) @import.source)

(extern_crate_declaration
  name: (identifier) @import.source)

(use_declaration) @import.statement
(mod_item !body) @import.statement
(extern_crate_declaration) @import.statement
`;

/** Inline modules (with a body) nest: `mod a { mod b {} }` declares `a::b`. */
const RUST_DECLARATION_QUERY = `
(mod_item
  name: (identifier) @declaration.name
  body: (declaration_list)) @declaration.module
`;

interface UsePath {
  readonly segments: string[];
  readonly wildcard: boolean;
  readonly alias?: string;
}

const USE_TREE_PUNCTUATION = new Set(['{', '}', ',', '*']);

/**
 * Splits a use-tree's text into `::`, `{`, `}`, `,`, `*` and words, skipping
 * whitespace and comments the way the Rust lexer does: `//` runs to the end
 * of the line and block comments nest (an inner opener needs its own closer
 * before the outer one closes). A word
 * is every character up to the next whitespace, punctuation or comment
 * opener, copied as written: identifiers keep combining marks, other
 * scripts and the `r#` raw prefix byte for byte (review r1 R32A-01/02).
 */
function tokenizeUseTree(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const opensComment = (at: number): boolean =>
    text[at] === '/' && (text[at + 1] === '/' || text[at + 1] === '*');
  while (i < text.length) {
    const c = text[i];
    if (/\s/u.test(c)) {
      i++;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      let depth = 0;
      do {
        if (text[i] === '/' && text[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      } while (depth > 0 && i < text.length);
    } else if (c === ':' && text[i + 1] === ':') {
      tokens.push('::');
      i += 2;
    } else if (USE_TREE_PUNCTUATION.has(c)) {
      tokens.push(c);
      i++;
    } else {
      const start = i;
      while (
        i < text.length &&
        !/\s/u.test(text[i]) &&
        !USE_TREE_PUNCTUATION.has(text[i]) &&
        text[i] !== ':' &&
        !opensComment(i)
      ) {
        i++;
      }
      // A lone `:` (not valid in a use tree) is skipped rather than looping.
      tokens.push(i > start ? text.slice(start, i) : text[i++]);
    }
  }
  return tokens.filter((t) => t !== ':');
}

/**
 * Expands a `use` argument into one path per leaf: `{a, b::c}` gives `a` and
 * `b::c`; `std::{self, io::Write as W}` gives `std` and `std::io::Write`
 * (alias `W`); `a::*` gives `a` as a wildcard. Parsed from the argument's
 * text because the captured node stops at depth 3 and use trees nest deeper.
 * A leading `::` stays in the path.
 */
function expandUseTree(text: string): UsePath[] {
  const tokens = tokenizeUseTree(text);
  const paths: UsePath[] = [];
  let i = 0;

  const tree = (prefix: readonly string[]): void => {
    const segments = [...prefix];
    if (tokens[i] === '::') {
      segments.push('');
      i++;
    }
    for (;;) {
      const token = tokens[i];
      if (token === '{') {
        i++;
        list(segments);
        if (tokens[i] === '}') i++;
        return;
      }
      if (token === '*') {
        i++;
        paths.push({ segments, wildcard: true });
        return;
      }
      if (token === undefined || /^[{},]$|^::$|^as$/.test(token)) break;
      segments.push(token);
      i++;
      if (tokens[i] !== '::') break;
      i++;
    }
    let alias: string | undefined;
    if (tokens[i] === 'as' && tokens[i + 1] !== undefined) {
      alias = tokens[i + 1];
      i += 2;
    }
    if (segments.length === prefix.length) return; // nothing parsed
    // `self` inside a list names the list's own prefix.
    const own =
      prefix.length > 0 &&
      segments.length === prefix.length + 1 &&
      segments[segments.length - 1] === 'self'
        ? segments.slice(0, -1)
        : segments;
    paths.push({ segments: own, wildcard: false, ...(alias ? { alias } : {}) });
  };

  const list = (prefix: readonly string[]): void => {
    while (i < tokens.length && tokens[i] !== '}') {
      const start = i;
      tree(prefix);
      if (tokens[i] === ',') i++;
      else if (i === start) i++; // skip a token no rule accepts
    }
  };

  tree([]);
  return paths;
}

function toRustImport(path: UsePath): ExtractedImport {
  const { segments, wildcard, alias } = path;
  const source = segments.join('::');
  const symbols = wildcard ? { importedSymbols: ['*'] } : {};
  const renamed = alias ? { alias } : {};
  if (segments[0] === 'self' || segments[0] === 'super') {
    let supers = 0;
    for (const segment of segments) {
      if (segment === 'super') supers++;
      else if (segment !== 'self') break;
    }
    return {
      source,
      kind: 'relative',
      relativeLevel: 1 + supers,
      ...symbols,
      ...renamed,
    };
  }
  return {
    source,
    kind: wildcard ? 'wildcard' : alias ? 'alias' : 'module',
    ...symbols,
    ...renamed,
  };
}

/**
 * `use` → one import per expanded path; `mod x;` → `mod-decl` (its scope,
 * from `scopePath`, says which directory holds `x.rs`); `extern crate x as y`
 * → the crate, aliased when renamed.
 */
function extractRustImports(statement: GenericAstNode): ExtractedImport[] {
  const parts = statement.children.filter(
    (c) =>
      c.isNamed &&
      c.type !== 'visibility_modifier' &&
      c.type !== 'line_comment' &&
      c.type !== 'block_comment',
  );
  if (statement.type === 'mod_item') {
    const name = parts.find((c) => c.type === 'identifier');
    return name ? [{ source: name.text, kind: 'mod-decl' }] : [];
  }
  if (statement.type === 'extern_crate_declaration') {
    const [name, alias] = parts.filter((c) => c.type === 'identifier');
    if (!name) return [];
    return [
      alias
        ? { source: name.text, kind: 'alias', alias: alias.text }
        : { source: name.text, kind: 'module' },
    ];
  }
  const argument = parts[parts.length - 1];
  return argument ? expandUseTree(argument.text).map(toRustImport) : [];
}

export const RUST_LANGUAGE: LanguageModule = {
  id: 'rust',
  extensions: ['.rs'],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-rust.wasm',
  queries: {
    functionQuery: RUST_FUNCTION_QUERY,
    classQuery: RUST_CLASS_QUERY,
    importQuery: RUST_IMPORT_QUERY,
    exportQuery: '',
  },
  extraction: {
    extractImports: extractRustImports,
    declarations: { query: RUST_DECLARATION_QUERY, scopeSeparator: '::' },
  },
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    graphEdges: null,
    // The Electron index-free declaration scan has no Rust query.
    definitionFallback: false,
    syntaxDiagnostics: true,
  },
};
