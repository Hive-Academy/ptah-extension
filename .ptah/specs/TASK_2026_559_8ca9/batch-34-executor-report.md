# Batch 34 executor report: C# import graph (Task 34.1 only)

Executor: backend-developer (sub-agent). Worktree `task-559-mcp-tool-contract`, branch `fix/task-559-mcp-tool-contract`, base HEAD `d72fbbc06`.

- No git command changed state. The only git commands used were read-only: `status`, `diff`, `log`, and `git show HEAD:<path>` for the FB run and to put back two files (see Deviations D6).
- The working tree is left dirty.
- `code-logic-review.md` and `research/diagnostics-worktree-repro.ts` are still untracked and were not touched.
- No changes by other writers were seen.

Scope (User Decision 27): Task 34.1 (C#) only. Task 34.2 (Java) is **deferred** and not implemented. Java, Kotlin, Rust, PHP, Ruby and C/C++ stay unsupported by the graph tools, and a test pins this for Java and Kotlin.

## Changed paths

`WI/` is `libs/backend/workspace-intelligence/src/`, `WIT/` is `WI/testing/mcp-contract/`, and `LM/` is `libs/backend/vscode-lm-tools/src/lib/code-execution/`.

### In the batch list

1. `WI/ast/import-resolution/csharp-import-resolver.ts` (new): `CSHARP_IMPORT_RESOLVER`.
   - **`using N`** links every graphed file that declares namespace `N`. The import is `kind: 'namespace'`, carries the approximation `csharp:namespace-edges`, and the importing file is left out of the targets.
   - **`using static N.T`** links the files that declare public type `T` in `N` when that type is known. That is a `file` edge with no approximation. Otherwise it links the files of the longest declared namespace the name starts with, which is a namespace edge.
   - **`using A = X`** links `X` as a namespace when one is declared. Otherwise it resolves `X` as a type, the same way `using static` does. Generic arguments are removed first (`N.T<int>` becomes `N.T`).
   - **`global using …`** resolves like the directive it prefixes, both for the file that declares it and, through the new `ImportResolver.implicitImports`, for every other file of the same project.
   - **Scope:** inside `namespace A.B { using X; }` the name is tried as `A.B.X`, then `A.X`, then `X`, which is the C# lookup rule. A `global::` name is looked up only in the global namespace.
   - **Name with no declaring file:**
     - `external` only with proof: a framework root (`System` or `Microsoft` and anything below), or a referenced package id. A package id proves the namespace when the namespace is the id or starts with `id.`; ids compare case-insensitively, as NuGet ids do.
     - If a workspace namespace starts with the same first segment, it is `unresolved-internal`.
     - Anything else is `external` with `contextDependent`, which makes the context `partial`.
     - A name that is not a dotted identifier path is also `external` with `contextDependent`: a tuple or array alias, or an `extern alias` `x::` qualifier.
   - **Resolves to nothing:** a namespace that holds only nested namespaces, or one that only the importing file declares, returns `linksNothing`. That means no edge, and the import is not counted as unresolved.
   - **Case:** C# names are case-sensitive, so the file-path case-folding rule does not apply.
   - **Per-import bound:** at most 200 targets, in sorted order, and `truncated` beyond that.
2. `WI/ast/import-resolution/csharp-import-resolver.spec.ts` (new): 24 tests.
   - Most run the real `tree-sitter-c-sharp.wasm` parser and the real `DependencyGraphService` over a temporary directory. Declarations, `scopePath` and import kinds therefore come from the real Batch 32a extraction, and the MSBuild files go through the bounded, handle-verified manifest reader.
   - Covered:
     - block, file-scoped and nested namespaces, and lookup through the enclosing namespace;
     - `global::`, the self edge, and a namespace that holds only other namespaces;
     - `using static` of a known type and of an unknown type, and aliases (namespace, type, generic);
     - `global using` across projects, including `global using static` and a global alias;
     - the cases where no `.csproj` exists and where a directory listing fails;
     - `<Using>` items in a `.csproj`, tallied once, and in the nearest `Directory.Build.props`;
     - an `<Import>` that is not followed;
     - framework and package proof, including a lowercase package id;
     - an unproven namespace next to a `ProjectReference` (no proof), a missing internal namespace, and a `.csproj` that is not a project;
     - **the 300-file namespace:** exactly the first 200 targets, `truncatedImports: 1`, and the answer is not clean. This test stubs the analysis, for speed;
     - the `readMsbuildItems` unit tests.
3. `WI/ast/languages/csharp.language.ts`:
   - `exportQuery: CSHARP_EXPORT_QUERY` captures every type and member declaration with its name (`export.cs_type` / `export.cs_member` / `export.cs_name`);
   - `importResolver: CSHARP_IMPORT_RESOLVER`;
   - `graphEdges: { granularity: 'namespace', referenceScopeComplete: false }`.
4. `WIT/matrix/activations/b34.ts` (new): activates `graphEdges:csharp` and `publicSymbols:csharp`, with the approximation `graphEdges:csharp → ['csharp:namespace-edges']`. The Java keys stay unactivated.

### Outside the batch list, and why

Production code:

5. `WI/ast/csharp-public-symbols.ts` (new). It decodes the `export.cs_*` captures (see "Public symbols" below). It is a separate file for the same reason as `python-public-symbols.ts`: visibility depends on the enclosing types, and the query language cannot express that.
6. `WI/ast/csharp-public-symbols.spec.ts` (new): 5 real-grammar tests (the visibility matrix, nested namespaces, partial disclosure, unreadable modifiers, no exports).
7. `WI/ast/export-extraction.ts`: sends C# captures to the decoder. Its records share the existing name/kind de-duplication.
8. `WI/ast/import-resolution/csharp-context.ts` (new). This holds the C# facts of the resolver context, so that `resolver-context.ts` stays a facade under 700 lines (it is 663):
   - the namespace → files index, and every enclosing namespace;
   - the type → files index;
   - the project of each file;
   - global usings per project, from C# files and from MSBuild `<Using>` items;
   - package ids;
   - the MSBuild manifest discovery (`findCSharpProjects`) and the reader (`readMsbuildItems`).
9. `WI/ast/import-resolution/resolver-context.ts`:
   - new option `parsedFiles` (the graph nodes);
   - a third manifest round that lists the directories of the C# files and their ancestors, then reads the `.csproj` and `Directory.Build.props`/`.targets` files found. These reads share the same 64-file limit and 2 MiB budget;
   - new field `csharp`;
   - new gaps `csharp-project-unknown` and `msbuild-import-not-read`.
10. `WI/ast/import-resolution/import-resolver.ts`:
    - `GraphEdgeApproximation` now includes `csharp:namespace-edges`;
    - `ImportResolution.linksNothing`;
    - `ImportResolver.implicitImports` and `ImplicitImport` (`declaredOutsideGraph`).
11. `WI/ast/dependency-graph.service.ts`:
    - `FileNode.declarations` (from `CodeInsights.declarations`);
    - `parsedFiles` is passed to the context;
    - the tallying in `linkNodes` is moved into a shared `tally` closure. `linksNothing` is not counted, implicit imports are linked, and an implicit import declared outside the graph is tallied once (by object identity);
    - the target loop becomes `linkTargets`. The edge cap and the yield or superseded checks are unchanged.

Specs that pinned "C# has no graph and no public symbols". Each is updated in the batch that changes the pin, as the registry spec requires:

12. `WI/ast/language-registry.spec.ts`:
    - `publicSymbols` and `graphEdges` gain `csharp`;
    - the "codeIndex and publicSymbols are separate" test now uses `java`/`rust`/`kotlin`;
    - new test "draws C# edges per namespace".
13. `WI/ast/ast-analysis.service.spec.ts`: the registration test now expects the C# export query.
14. `WI/ast/csharp-grammar.integration.spec.ts`: "produces no exports" becomes "lists the public declarations as exports (Batch 34)", which pins the exact 14 exports of the existing sample.
15. `WI/ast/dependency-graph.service.spec.ts` and `WI/ast/graph-coverage.spec.ts`: `supportedLanguages` gains `csharp`.
16. `WI/ast/import-resolution/ts-js-import-resolver.spec.ts`: the hand-built context gains `csharp: EMPTY_CSHARP_LAYOUT`.
17. `WIT/language-honesty.contract.spec.ts`:
    - `HONESTY_CHECKS` gains `graphEdges:csharp` (`csharpGraphHonesty`) and `publicSymbols:csharp`;
    - `publicSymbolsHonesty` also accepts `csharp`;
    - **deferred-language honesty:** in the C# graph check, a `.java` file and a `.kt` file sit next to the C# files. The check asserts `unsupported: 2`, `unsupportedByLanguage { java: 1, kotlin: 1 }`, no edges for the Java file, and `isCleanAnswer` false.
18. `LM/namespace-builders/analysis-namespace.builders.spec.ts`: `supportedLanguages` gains `csharp`, `src/Program.cs` is now graph-capable, and there is a comment that Java is deferred.
19. `LM/mcp-core/protocol-dispatcher.spec.ts`: `supportedLanguages` gains `csharp`.
20. `LM/namespace-builders/ast-namespace.builder.spec.ts`: "24a rejects … exports" now uses Java, and the mocked extension map has `.java` instead of `.cs`.
21. `LM/namespace-builders/code-namespace.builder.spec.ts`: "C# stays searchable while C# queryExports errors" becomes the same test for Java.
22. `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`: the six real-graph narrowing tests give the mocked `referenceScopeComplete` claim to `csharp` as well. The gate checks every graph language, so without this the control never narrows and the negative tests pass vacuously. This is the same reason Batch 33 gave.

Task documents: the Batch 34 heading in `batches.md` (only that line) and this report.

## Public symbols: the decision

Implemented in `csharp-public-symbols.ts` and documented in its module comment.

- **Listed:**
  - a type declared in a namespace or the compilation unit (class, struct, record, interface, enum, delegate) with `public`;
  - a type nested one level inside a public type, with `public`, or with no access modifier when the owner is an interface;
  - a method, property, field, constant or event of a public type, under the same rule. Interface members with no modifier are public.
- **Not listed:**
  - `internal`, which is assembly-private;
  - `protected` and `protected internal`, which only derived types can see;
  - `private protected`, `private` and `file`;
  - enum members, constructors, operators and indexers;
  - types nested two or more levels deep.

  The index answers "what can another file import and name".

- **Disclosed, not dropped:** these go to `unextractedExports`, and the file keeps the existing incomplete marker:
  - a `partial` type with no access modifier, because another part decides its visibility. Its members are covered by that one disclosure;
  - a declaration with an `ERROR` child among its modifiers, for example `#if` between modifiers.

## MSBuild usings (a gap found while applying the Batch 33 lesson)

SDK-style `.csproj` files and `Directory.Build.props`/`.targets` can declare global usings as `<Using Include="N" [Static="true"] [Alias="A"] />`. If these were ignored, edges would be missing silently while the answer read clean. They are modelled as follows:

- A project's global usings are its C# `global using` directives, plus the `<Using>` items of its own `.csproj`, plus those of the nearest `Directory.Build.props` and the nearest `Directory.Build.targets` at or above its directory. MSBuild imports only the nearest of each.
- There is one `ImportInfo` per manifest item, so the graph tallies it once. A test shows an unproven `<Using Include="Contoso.Unknown">` shared by two files counts `external: 1` and makes the context `partial`.
- An `<Import Project="…">` is not followed, and it adds the gap `msbuild-import-not-read`.
- `<PackageReference>` and `<GlobalPackageReference>` ids are proof of externality. A `ProjectReference` never is.

## FB evidence (fails on base)

Method: the base `csharp.language.ts` was put in place with `git show HEAD:<L>/csharp.language.ts > <L>/csharp.language.ts`. The new specs and keys were run against it, and the working copy was then restored from a backup. `git diff --stat` on the file afterwards showed exactly this batch's change (48 insertions, 3 deletions).

- Command: `npx jest -c libs/backend/workspace-intelligence/jest.config.ts --maxWorkers=2 …/language-honesty.contract.spec.ts …/csharp-import-resolver.spec.ts …/csharp-public-symbols.spec.ts …/csharp-grammar.integration.spec.ts …/language-registry.spec.ts`
- Result: **`Tests: 29 failed, 200 passed, 229 total`**.
- Failures included:
  - "every activated capability:language key is actually granted by the registry": received `["graphEdges:csharp","publicSymbols:csharp"]`;
  - `graphEdges:csharp`: "c# App/Report.cs did not link the namespace's files: []";
  - `publicSymbols:csharp`: "csharp public symbols wrong: missing ["Widget","Size","Render"]";
  - all resolver-spec edge, proof, global-using, MSBuild and 300-file-bound tests (the base language has no resolver, so every import is unresolved);
  - the 5 public-symbol tests and the grammar-integration export pin;
  - the registry `publicSymbols`/`graphEdges` lists and "draws C# edges per namespace".

  The two `readMsbuildItems` tests do not depend on the language module, so they are not FB cases.

- After the restore, all of them pass (see Verification).

## Description budget

The brief expected `ptah_get_symbol_index` to be at 996 of 1,000 characters, and adding C# to push it past 1,000. The current source does not bear that out. The description lists already use the compact aliases (`DESCRIPTION_LANGUAGE_NAMES`, `ts,js,tsx,py,go,cs`). That came from Batch 31 and was merged into this branch after the Batch 33 report's figure was taken. Adding C# adds only `,cs` (3 characters).

Measured with the builders, `csharp` granted:

| Tool                       | Now | Budget / pin                       | Changed? |
| -------------------------- | --- | ---------------------------------- | -------- |
| `ptah_get_symbol_index`    | 975 | < 1000 (`DESCRIPTION_CHAR_BUDGET`) | no       |
| `ptah_code_search_symbols` | 680 | ≤ 702 (brief), sweep pin 714       | no       |
| `ptah_code_reindex`        | 522 | ≤ 536                              | no       |
| `ptah_get_dependents`      | 708 | 734                                | no       |
| `ptah_get_dependencies`    | 678 | 701                                | no       |
| `ptah_ast_analyze`         | 473 | 515                                | no       |

- **No change was needed:** no pin was raised, the 1,000 limit was not touched, and no honesty wording was dropped. The mechanism the brief asks for, the compact shared alias list, is already how the list is produced.
- **Headroom:** with every planned graph language listed (`ts,js,tsx,py,go,cs,java,rs,php,rb,cpp`, 22 more characters), the symbol-index description would be about 997. That still fits, but only just.
- **How it was measured:** a temporary spec, deleted afterwards, called each `build*Tool()`.

## Verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools ptah-electron --skip-nx-cache --parallel=2` → "Successfully ran targets test, lint, typecheck for 3 projects and 6 tasks they depend on" (final run after all changes).
- Jest directly (`--maxWorkers=2`):
  - workspace-intelligence: `Test Suites: 1 skipped, 69 passed`, `Tests: 10 skipped, 2202 passed, 2212 total`;
  - vscode-lm-tools: `Test Suites: 77 passed`, `Tests: 2466 passed, 2466 total`;
  - ptah-electron: `Test Suites: 1 skipped, 54 passed`, `Tests: 3 skipped, 955 passed, 958 total`.
- `node_modules/.bin/nx run ptah-cli:typecheck --skip-nx-cache` → "Successfully ran target typecheck for project ptah-cli".
- `npx nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `npx nx run degradation-audit:lint --skip-nx-cache` → **`TOTAL 300`** (workspace-intelligence 1 against baseline 1, vscode-lm-tools 2 against baseline 2). The one new `catch` (a directory listing in `csharp-context.ts`) assigns values and does not return.
- `npx prettier --check` on every changed `.ts` file passes. The only warning is for the untracked `research/diagnostics-worktree-repro.ts`, which is not mine and was not touched.
- The first full runs, before the pins were updated, failed exactly the pins listed in items 12–22:
  - workspace-intelligence: 7;
  - vscode-lm-tools: 13;
  - Electron: 1 (the narrowing control).

## Deviations

- **D1, footprint:** 23 source and spec paths instead of 4 (17 modified, 6 new). Items 5–22 give the reason for each:
  - the decoder and the context split, under the facade rule;
  - the seam: implicit imports, `linksNothing` and the approximation type;
  - the specs that pinned "C# has no graph or public symbols".
- **D2, `global using` needs a seam:** the resolver interface is per import, so global usings reach other files through a new optional `ImportResolver.implicitImports`. A directive written in a C# file is tallied once, in that file. A manifest `<Using>` item is tallied the first time it is resolved.
- **D3, MSBuild `<Using>` items and `Directory.Build.*`:** these are not in the brief. They were added so that a global using declared outside C# source is not silently lost (the Batch 33 lesson). An `<Import>` is disclosed, not followed.
- **D4, project discovery is bounded:** at most 1,000 directory listings, each through the injected `ManifestFileSystem`. Either a failed or a cut listing always adds the `csharp-project-unknown` gap, because a missed project file could declare global usings. So does a `global using` in a file with no `.csproj` (the brief's "whole root" case).
- **D5, the `Microsoft.*` root counts as proof:** the brief allows it. `Microsoft.Extensions.*` and similar are NuGet packages, not always the shared framework, but either way they are outside the workspace, and a workspace declaration is always tried first.
- **D6, own mistake, corrected:** a glob `prettier --write` reformatted two specs I had not changed (`LM/namespace-builders/dashboard-namespace.builder.spec.ts` and `ide-namespace.builder.spec.ts`). Their HEAD content was written back with the read-only `git show HEAD:<path> > <path>`, and `git status` shows both clean.
- **D7, description budget:** no change. The premise was out of date (see "Description budget").

## Known limits (disclosed or documented, not fixed)

- **Namespace edges are coarse** (`csharp:namespace-edges`):
  - a file that uses one type of a namespace depends on every file of it;
  - `using static` of a non-public type falls back to the namespace;
  - a type is filed under every namespace its file declares.
- **Not modelled**, which is why `referenceScopeComplete` is false: same-namespace use with no `using`, `ImplicitUsings` (framework namespaces only, so no workspace edges are lost), extension methods, reflection and DI, `<Compile Include/Remove>`, `<Using Remove>`, and nested project directories (the nearest `.csproj` wins).
- **Package proof is by name:** a package whose namespaces differ from its id stays unproven, and so `partial`. `Directory.Packages.props` carries only versions and is not read.
- **Public symbols:** `protected` members and types nested two or more levels deep are not listed, by decision. Enum members are not listed either.
- **Performance:** a resolution that finds nothing scans the namespace and package sets once per import. That is linear, and fine at the manifest limits, but not indexed.
- **Resolver-context size:** `resolver-context.ts` is 663 of 700 lines. Batch 35 (Cargo) will need to extract more.

## Fix round (closing reviews)

Sources: `reviews/batch-34-lane-g2-closing-review-glm.md` (REVISE 6/10) and `reviews/batch-34-lane-g2-closing-review-claude.md` (APPROVE 8/10). This is the one round under Decision 24.

- No git state was changed.
- Prettier was run only on explicit file paths this batch changed.
- `.ptah/specs/TASK_2026_559_8ca9/context.md` now shows as modified in `git status`. That edit is another writer's; I did not touch it.

Paths below are relative to `libs/backend/workspace-intelligence/src/ast/`.

### Findings → fixes → regression tests

1. **R34G-01 (Blocking): MSBuild usings were dropped for the root group.**
   - **Fix** (`import-resolution/csharp-context.ts`, `csharpLayout` and the new `indexManifests`): a file that no `.csproj` encloses is now in the root group.
     - It is keyed by the nearest `Directory.Build.props` and `.targets` at or above its directory. This is the same nearest-manifest rule that projects use.
     - The `<Using>` items of those manifests reach it, and a `global using` in any root-group file reaches every root-group file.
     - Any global using that reaches the root group, whether declared in a file or in a manifest, raises `csharp-project-unknown`.
     - `projectOf` for a root-group file is `''`, or a key naming its nearest manifests.
   - **Tests** (`csharp-import-resolver.spec.ts` › "closing-review fixes"):
     - "R34G-01: with no .csproj, …": the reviewer's fixture. It asserts the edge `App/Program.cs → Billing/Invoice.cs` (and `Order.cs`), that the context is `partial` and not clean, that `ctx.gaps` contains `csharp-project-unknown`, and that `implicitImports` returns the props using with `declaredOutsideGraph`;
     - "… in a mixed tree, …": a `.csproj` subtree plus a top-level `Tools/Script.cs` outside it. Both link Billing, and the context is `partial`;
     - "… a root-group global using still reaches every root-group file, not the projects".
   - **Existing test adjusted:** "the nearest Directory.Build.props applies …" now gives the Billing and Util files their own `.csproj`. Without that they would form a root group, and its `partial` result would now be correct.
2. **R34G-02 (Serious): a property-built `<Using>` value was skipped silently.**
   - **Fix:**
     - `readMsbuildItems` reports `unevaluatedUsings`. A `$(…)` value is still skipped as package proof.
     - `resolver-context.ts` adds the new gap `msbuild-using-not-evaluated`, documented in `ResolverContextGap`.
   - **Test:** "R34G-02: a property-built <Using> value is disclosed, not skipped silently". It checks the reader flag, a real graph with `<Using Include="$(RootNamespace).Models" />` reading `partial` and not clean, and the gap present in the context.
3. **R34G-04 (Minor): types from a file with no extracted declarations were filed under the global namespace.**
   - **Fix:**
     - `dependency-graph.service.ts` now keeps `FileNode.declarations` when it is empty. Empty means "declares none"; absent means "not extracted".
     - In `csharp-context.ts`, a file whose declarations are absent files its types nowhere.
     - `csharp-import-resolver.ts` `linkTo`: a type match in the global namespace is a namespace edge carrying `csharp:namespace-edges`, never a precise `file` edge. A namespace lost to a parse error also produces an empty list, so such a match cannot be trusted.
   - **Tests** (hand-made facts through `buildResolverContext`):
     - "R34G-04: a type whose file has no extracted declarations is filed nowhere";
     - "R34G-04: a type of the global namespace links with the approximation, never as a precise file edge".
4. **R34C-01 (Moderate): the tally-once check relied on an unstated invariant.**
   - **Fix:** a comment at the `talliedImplicit` check in `dependency-graph.service.ts` states the invariant. A manifest using is looked up with an empty `scopePath` (global namespace only), and `fromFile` only removes the file itself from the targets. So whether it is external, unresolved or linked does not depend on which file resolves it first.
   - **Test:** "R34C-01: a missing manifest using shared by two files is tallied once". `<Using Include="Acme.Missing">`, with two project files, gives `unresolvedInternal: 1`.
5. **R34G-03 (Serious): checked, not adopted.**
   - **The reviewer's claim:** after `using Acme;`, where `Acme` holds only nested namespaces, the file should link the `Acme.Billing` files.
   - **Why it does not apply:** the C# language specification, "Using namespace directives", says a using-namespace-directive "imports the types contained in the given namespace, but specifically does not import nested namespaces". Its own example has `using N1;` followed by `N2.A` being an error. So after `using Acme;`, `Billing.Invoice` does not bind. The reviewer's `Acme.Billing.Invoice i;` is a fully qualified reference that needs no directive, which is the gap already declared as `referenceScopeComplete: false`.
   - **What was done:** no fan-out edges were added. The rationale and the rule are now a code comment at the `linksNothing` branch in `csharp-import-resolver.ts`.

Carried with no change, as instructed: R34C-02 (records and structs have `kind: 'class'`) and R34C-03.

### FB for this round

- The new regression tests encode the reviewers' reproductions:
  - R34G-01: gaps `[]`, no implicit import, and a clean answer on the pre-fix code;
  - R34G-02: `usings: []` with no disclosure.
- The pre-fix `csharp-context.ts` was an untracked file, and no copy of it was kept, so these tests were not rerun against it. The reviewers' independent probes are the FB for this round.

### Verification (fix round)

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools ptah-electron --skip-nx-cache` → "Successfully ran targets test, lint, typecheck for 3 projects and 6 tasks they depend on".
- workspace-intelligence through jest directly: `Tests: 10 skipped, 2209 passed, 2219 total`. `csharp-import-resolver.spec.ts` has 31 tests.
- `node_modules/.bin/nx run ptah-cli:typecheck --skip-nx-cache` → Successfully.
- `npx nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `npx nx run degradation-audit:lint --skip-nx-cache` → **TOTAL 300** (workspace-intelligence 1 against baseline 1, vscode-lm-tools 2 against baseline 2).
- `npx prettier --check` on every changed `.ts` file passes.
- File sizes: `csharp-context.ts` is 493 lines and `resolver-context.ts` 674, so both stay under 700.
