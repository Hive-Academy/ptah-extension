/**
 * C# public symbols (TASK_2026_559 Batch 34 `publicSymbols`), decoded from
 * the `export.cs_*` captures of the C# export query
 * (`languages/csharp.language.ts`) by `extractExportsFromMatches`.
 *
 * What is public (the decision, documented for the symbol index):
 * - a type declared in a namespace or the compilation unit (class, struct,
 *   record, interface, enum, delegate) with the `public` modifier;
 * - a type nested in a public type, with `public` (or, in an interface, no
 *   access modifier: interface members are public by default);
 * - a method, property, field, constant or event of a public type, by the
 *   same rule.
 *
 * `internal` (assembly-private), `protected` and `protected internal`
 * (visible only to derived types), `private protected`, `private` and `file`
 * are not public symbols: the index answers "what can another file import
 * and name". Enum members, constructors, operators, indexers and types
 * nested two or more levels deep are not listed (members of a public type
 * nested one level are).
 *
 * Disclosed as unextracted, never dropped silently (the file then stays in
 * the index with the incomplete marker):
 * - a `partial` type with no access modifier, whose visibility another part
 *   decides (its members and nested types are covered by that disclosure);
 * - a declaration whose modifiers the parser could not read (an `ERROR`
 *   among them, e.g. a preprocessor directive between modifiers), when it
 *   could be public.
 */
import type { ExportInfo } from './ast-analysis.interfaces';
import type { GenericAstNode } from './ast.types';
import type { ExportRowRange } from './export-extraction';
import type { QueryCapture, QueryMatch } from './tree-sitter-parser.service';

/** Capture names of the C# export query. */
export const CSHARP_CAPTURES = {
  type: 'export.cs_type',
  member: 'export.cs_member',
  name: 'export.cs_name',
} as const;

/** One declaration the query found: a type or a member, and its name. */
export interface CSharpCandidate {
  readonly declaration: QueryCapture;
  readonly name: QueryCapture;
  readonly isType: boolean;
  readonly rows: ExportRowRange;
}

/** The candidate of `match`, or `undefined` when it has no C# capture. */
export function csharpCandidate(
  match: QueryMatch,
  rows: ExportRowRange,
): CSharpCandidate | undefined {
  let type: QueryCapture | undefined;
  let member: QueryCapture | undefined;
  let name: QueryCapture | undefined;
  for (const capture of match.captures) {
    if (capture.name === CSHARP_CAPTURES.type) type = capture;
    else if (capture.name === CSHARP_CAPTURES.member) member = capture;
    else if (capture.name === CSHARP_CAPTURES.name) name = capture;
  }
  const declaration = type ?? member;
  if (declaration === undefined || name === undefined) return undefined;
  return { declaration, name, isType: type !== undefined, rows };
}

type Visibility = 'public' | 'hidden' | 'unknown';

const ACCESS_MODIFIERS: ReadonlySet<string> = new Set([
  'public',
  'private',
  'protected',
  'internal',
  'file',
]);

const TYPE_KINDS: Readonly<Record<string, ExportInfo['kind']>> = {
  class_declaration: 'class',
  struct_declaration: 'class',
  record_declaration: 'class',
  interface_declaration: 'interface',
  enum_declaration: 'enum',
  delegate_declaration: 'type',
};

const MEMBER_KINDS: Readonly<Record<string, ExportInfo['kind']>> = {
  method_declaration: 'function',
  property_declaration: 'variable',
  field_declaration: 'variable',
  event_field_declaration: 'variable',
  event_declaration: 'variable',
};

/** Apply the rules in the module comment, in source order. */
export function csharpPublicSymbols(candidates: readonly CSharpCandidate[]): {
  exports: Array<{ info: ExportInfo; rows: ExportRowRange }>;
  unextracted: QueryCapture[];
} {
  const types = candidates.filter((candidate) => candidate.isType);
  const owners = new Map<CSharpCandidate, CSharpCandidate[]>();
  for (const candidate of candidates) {
    owners.set(candidate, ownersOf(candidate, types));
  }
  const ownersFor = (candidate: CSharpCandidate): CSharpCandidate[] =>
    owners.get(candidate) ?? [];
  const visibility = new Map<CSharpCandidate, Visibility>();
  // Outer types first, so a nested type reads its owner's visibility.
  const byDepth = [...types].sort(
    (a, b) => ownersFor(a).length - ownersFor(b).length,
  );
  for (const type of byDepth) {
    visibility.set(type, visibilityOf(type, ownersFor(type), visibility));
  }

  const exports: Array<{ info: ExportInfo; rows: ExportRowRange }> = [];
  const unextracted: QueryCapture[] = [];
  for (const candidate of candidates) {
    const enclosing = ownersFor(candidate);
    const kinds = candidate.isType ? TYPE_KINDS : MEMBER_KINDS;
    const kind = kinds[candidate.declaration.node.type];
    if (kind === undefined) continue;
    const decided = candidate.isType
      ? (visibility.get(candidate) ?? 'hidden')
      : visibilityOf(candidate, enclosing, visibility);
    if (decided === 'public') {
      exports.push({
        info: { name: candidate.name.text, kind },
        rows: candidate.rows,
      });
    } else if (decided === 'unknown' && !ownerUnknown(enclosing, visibility)) {
      unextracted.push(candidate.declaration);
    }
  }
  return { exports, unextracted };
}

/**
 * A declaration's visibility. A top-level type needs `public`. A member, or
 * a type nested directly in a top-level type, needs a public innermost owner
 * and `public` (or no access modifier inside an interface); a type nested
 * deeper is not listed. An owner whose visibility is unknown makes its
 * contents unknown.
 */
function visibilityOf(
  candidate: CSharpCandidate,
  owners: readonly CSharpCandidate[],
  known: ReadonlyMap<CSharpCandidate, Visibility>,
): Visibility {
  const owner = owners[owners.length - 1];
  if (owner !== undefined) {
    const ownerVisibility = known.get(owner) ?? 'hidden';
    if (ownerVisibility !== 'public') return ownerVisibility;
    // Nested types are listed one level down only.
    if (candidate.isType && owners.length > 1) return 'hidden';
  }
  const node = candidate.declaration.node;
  const modifiers = modifiersOf(node);
  const access = modifiers.filter((modifier) => ACCESS_MODIFIERS.has(modifier));
  const unreadable = node.children.some((child) => child.type === 'ERROR');
  if (access.length === 1 && access[0] === 'public') {
    return unreadable ? 'unknown' : 'public';
  }
  if (access.length > 0) return unreadable ? 'unknown' : 'hidden';
  if (unreadable) return 'unknown';
  if (owner?.declaration.node.type === 'interface_declaration') {
    return 'public';
  }
  // A partial part with no access modifier: another part may make it public.
  if (candidate.isType && modifiers.includes('partial')) return 'unknown';
  return 'hidden';
}

/** Whether the innermost owner's visibility is unknown (already disclosed). */
function ownerUnknown(
  owners: readonly CSharpCandidate[],
  known: ReadonlyMap<CSharpCandidate, Visibility>,
): boolean {
  const owner = owners[owners.length - 1];
  return owner !== undefined && known.get(owner) === 'unknown';
}

/** The types enclosing `candidate`, outermost first. */
function ownersOf(
  candidate: CSharpCandidate,
  types: readonly CSharpCandidate[],
): CSharpCandidate[] {
  return types
    .filter(
      (type) =>
        type !== candidate &&
        type.declaration.node !== candidate.declaration.node &&
        encloses(type.declaration, candidate.declaration),
    )
    .sort((a, b) => (encloses(a.declaration, b.declaration) ? -1 : 1));
}

function encloses(outer: QueryCapture, inner: QueryCapture): boolean {
  const starts =
    outer.startPosition.row < inner.startPosition.row ||
    (outer.startPosition.row === inner.startPosition.row &&
      outer.startPosition.column <= inner.startPosition.column);
  const ends =
    outer.endPosition.row > inner.endPosition.row ||
    (outer.endPosition.row === inner.endPosition.row &&
      outer.endPosition.column >= inner.endPosition.column);
  const same =
    outer.startPosition.row === inner.startPosition.row &&
    outer.startPosition.column === inner.startPosition.column &&
    outer.endPosition.row === inner.endPosition.row &&
    outer.endPosition.column === inner.endPosition.column;
  return starts && ends && !same;
}

/** The declaration's modifier keywords (`public`, `static`, `partial`, …). */
function modifiersOf(node: GenericAstNode): string[] {
  return node.children
    .filter((child) => child.type === 'modifier')
    .map((child) => child.text.trim());
}
