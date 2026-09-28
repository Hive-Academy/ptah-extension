/**
 * C# import resolution (TASK_2026_559 implementation-plan-languages.md,
 * "Dependency graphs", C# row; Batch 34). Namespace edges: a `using`
 * directive links the graphed files that declare the namespace it names,
 * disclosed as the `csharp:namespace-edges` approximation (which of them
 * declares what the file uses is not known without binding its names).
 *
 * - `using N;` links the files declaring namespace `N`.
 * - `using static N.T;` links the files declaring public type `T` in `N`
 *   when that is known (a file edge, no approximation), else the files of
 *   `N`, the longest declared namespace the name starts with.
 * - `using A = N.T;` links the target: namespace `N.T` when declared, else
 *   type `T` in `N` as for `using static` (generic arguments are dropped:
 *   `List<Acme.Item>` names `List`).
 * - `global using …` resolves like the directive it prefixes, for the file
 *   that declares it and, through {@link ImportResolver.implicitImports},
 *   for every other C# file of the same project; so does a project
 *   manifest's `<Using Include="…">` item, for every file of the project
 *   (`csharp-context.ts`).
 * - Inside `namespace A.B { … }` a name is looked up in `A.B`, then `A`,
 *   then the global namespace (the C# rule for using directives); a
 *   `global::` name only in the global namespace.
 *
 * A name no workspace file declares is `external` only with proof: a .NET
 * framework namespace (`System`, `Microsoft` and below), or the id of a
 * package reference of an MSBuild manifest read (a `.csproj`, a
 * `Directory.Build.props`/`.targets`; the name is the id or starts with
 * `id.`; ids compare case-insensitively, as NuGet's do). Otherwise, when a
 * workspace namespace starts with the same first segment, it is
 * `unresolved-internal`; any other name is `external` only as far as the
 * context knows (`contextDependent`: the build's context is `partial`).
 *
 * C# names are case-sensitive, so the plan's case-folding rule (for file
 * paths) does not apply. A namespace that only the importing file declares,
 * or that holds only nested namespaces, links nothing and is not unresolved
 * (`linksNothing`).
 *
 * Not modelled (why `graphEdges.referenceScopeComplete` is false): files of
 * one namespace use each other with no `using`; `ImplicitUsings` (all
 * framework namespaces); extension methods; reflection and dependency
 * injection; `<Compile Include>` items that move files between projects.
 */
import type { ImportInfo } from '../ast-analysis.interfaces';
import {
  MAX_TARGETS_PER_IMPORT,
  type ImplicitImport,
  type ImportResolution,
  type ImportResolver,
} from './import-resolver';
import type { ResolverContext } from './resolver-context';

const EXTERNAL: ImportResolution = { kind: 'external', targets: [] };
const UNPROVEN_EXTERNAL: ImportResolution = {
  kind: 'external',
  targets: [],
  contextDependent: true,
};
const UNRESOLVED_INTERNAL: ImportResolution = {
  kind: 'unresolved-internal',
  targets: [],
};
const LINKS_NOTHING: ImportResolution = {
  kind: 'namespace',
  targets: [],
  linksNothing: true,
};

/** First segments of the .NET framework's own namespaces. */
const FRAMEWORK_ROOTS: ReadonlySet<string> = new Set(['System', 'Microsoft']);

/** One identifier segment (`@` marks a verbatim identifier). */
const SEGMENT =
  /^@?[\p{L}\p{Nl}_][\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}\p{Cf}]*$/u;

/** A resolved name: the namespace, and the files of type `T` in it if known. */
interface NameMatch {
  readonly namespace: string;
  readonly typeFiles?: readonly string[];
}

export const CSHARP_IMPORT_RESOLVER: ImportResolver = {
  resolve(
    imp: ImportInfo,
    fromFile: string,
    ctx: ResolverContext,
  ): ImportResolution {
    const name = parseName(imp.source);
    if (name === undefined) return UNPROVEN_EXTERNAL;
    const typeAllowed = imp.isStatic === true || imp.alias !== undefined;
    const scopes = name.globalQualified ? [''] : enclosingScopes(imp);
    for (const scope of scopes) {
      const match = lookup(name.segments, scope, typeAllowed, ctx);
      if (match !== undefined) return linkTo(match, fromFile, ctx);
    }
    // A namespace that holds only nested namespaces: valid, nothing to link.
    // A using-namespace-directive imports the types a namespace contains,
    // "but specifically does not import nested namespaces" (C# language
    // specification, "Using namespace directives"): after `using Acme;`,
    // `Billing.Invoice` does not bind to `Acme.Billing.Invoice`. A file that
    // writes the qualified `Acme.Billing.Invoice` depends on it through no
    // directive at all, the reference-scope gap the capability already
    // declares (`referenceScopeComplete: false`). So no fan-out edges (review
    // R34G-03, checked against the specification and not adopted).
    for (const scope of scopes) {
      if (ctx.csharp.namespaces.has(join(scope, name.segments.join('.')))) {
        return LINKS_NOTHING;
      }
    }
    return outsideTheWorkspace(name.segments, ctx);
  },

  implicitImports(fromFile: string, ctx: ResolverContext): ImplicitImport[] {
    const project = ctx.csharp.projectOf.get(fromFile);
    if (project === undefined) return [];
    return (ctx.csharp.globalUsings.get(project) ?? [])
      .filter((using) => using.file !== fromFile)
      .map((using) =>
        using.fromManifest === true
          ? { imp: using.imp, declaredOutsideGraph: true }
          : { imp: using.imp },
      );
  },
};

/**
 * The name a directive names, as segments: whitespace, `global::`, `@` and
 * generic arguments removed. `undefined` when it is not a dotted name (a
 * tuple or array alias, an `extern alias` qualifier).
 */
function parseName(
  source: string,
): { segments: string[]; globalQualified: boolean } | undefined {
  const compact = source.replace(/\s+/g, '');
  const globalQualified = compact.startsWith('global::');
  const text = withoutTypeArguments(
    globalQualified ? compact.slice('global::'.length) : compact,
  );
  if (text === undefined || text.includes('::')) return undefined;
  const segments = text.split('.');
  if (!segments.every((segment) => SEGMENT.test(segment))) return undefined;
  return {
    segments: segments.map((segment) => segment.replace(/^@/, '')),
    globalQualified,
  };
}

/** `A.B<C<D>>.E` → `A.B.E`; `undefined` when the brackets do not balance. */
function withoutTypeArguments(text: string): string | undefined {
  let result = '';
  let depth = 0;
  for (const char of text) {
    if (char === '<') depth++;
    else if (char === '>') {
      if (--depth < 0) return undefined;
    } else if (depth === 0) result += char;
  }
  return depth === 0 ? result : undefined;
}

/**
 * The namespaces a directive's names are looked up in, innermost first:
 * `scopePath` `['A', 'B.C']` → `A.B.C`, `A.B`, `A`, then `''` (global).
 */
function enclosingScopes(imp: ImportInfo): string[] {
  const segments = (imp.scopePath ?? [])
    .join('.')
    .split('.')
    .filter((segment) => segment !== '');
  const scopes: string[] = [];
  for (let length = segments.length; length > 0; length--) {
    scopes.push(segments.slice(0, length).join('.'));
  }
  scopes.push('');
  return scopes;
}

/**
 * `segments` in `scope`: a declared namespace, or (static and alias
 * directives) type `T` of the longest declared namespace it starts with.
 */
function lookup(
  segments: readonly string[],
  scope: string,
  typeAllowed: boolean,
  ctx: ResolverContext,
): NameMatch | undefined {
  const full = join(scope, segments.join('.'));
  if (ctx.csharp.namespaceFiles.has(full)) return { namespace: full };
  if (!typeAllowed) return undefined;
  for (let length = segments.length - 1; length >= 0; length--) {
    const namespace = join(scope, segments.slice(0, length).join('.'));
    const typeFiles = ctx.csharp.typeFiles.get(
      `${namespace}\u0000${segments[length]}`,
    );
    if (typeFiles !== undefined) return { namespace, typeFiles };
    // The scope itself is not a match on its own: that would bind any name.
    if (length > 0 && ctx.csharp.namespaceFiles.has(namespace)) {
      return { namespace };
    }
  }
  return undefined;
}

function linkTo(
  match: NameMatch,
  fromFile: string,
  ctx: ResolverContext,
): ImportResolution {
  const files = (
    match.typeFiles ??
    ctx.csharp.namespaceFiles.get(match.namespace) ??
    []
  ).filter((file) => file !== fromFile);
  if (files.length === 0) return LINKS_NOTHING;
  const truncated = files.length > MAX_TARGETS_PER_IMPORT;
  const targets = truncated ? files.slice(0, MAX_TARGETS_PER_IMPORT) : files;
  // A type filed under the global namespace may be one whose namespace
  // declaration was lost to a parse error (review R34G-04): not precise.
  return match.typeFiles !== undefined && match.namespace !== ''
    ? { kind: 'file', targets, ...(truncated ? { truncated: true } : {}) }
    : {
        kind: 'namespace',
        targets,
        approximation: 'csharp:namespace-edges',
        ...(truncated ? { truncated: true } : {}),
      };
}

/** A name no workspace file declares (see the module comment). */
function outsideTheWorkspace(
  segments: readonly string[],
  ctx: ResolverContext,
): ImportResolution {
  if (FRAMEWORK_ROOTS.has(segments[0])) return EXTERNAL;
  const folded = segments.join('.').toLowerCase();
  for (const id of ctx.csharp.packages) {
    const packageId = id.toLowerCase();
    if (folded === packageId || folded.startsWith(`${packageId}.`)) {
      return EXTERNAL;
    }
  }
  for (const namespace of ctx.csharp.namespaces) {
    if (namespace.split('.')[0] === segments[0]) return UNRESOLVED_INTERNAL;
  }
  return UNPROVEN_EXTERNAL;
}

function join(scope: string, name: string): string {
  if (scope === '') return name;
  return name === '' ? scope : `${scope}.${name}`;
}
