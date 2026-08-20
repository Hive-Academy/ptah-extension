# Development Tasks — TASK_2026_270

**Batches**: 6 | **Branch**: `ak/tui-defects` | **Decomposed**: 2026-08-17

Sequencing: 1, 1b and 2 are independent and run in parallel. 3 needs 1.
4 needs 1+2+3. 5 is last.

---

## Batch 1 — StackProfile registry + detection unification

**Agent**: backend-developer

- `StackProfile` type + `STACK_PROFILES` registry (`node-ts`, `dotnet`,
  `python`) in `libs/shared` (zero-dep, importable by both sides).
- `node-ts` must reproduce today's behaviour exactly — that is the regression bar.
- Rewire `HarnessWorkspaceContextService.resolveWorkspaceContext` and
  `isWorkspaceEffectivelyEmpty` to read `detect` from the registry. Fixes
  `Languages: (none detected)` on .NET repos AND the solution-only-reads-as-empty
  bug in one move.
- Point `ProjectDetectorService` at the same table; add `.vbproj`, `.slnx`,
  `global.json`, `Directory.Build.props`, `uv.lock`, `poetry.lock`.
- `FrameworkDetectorService`: add a `DotNet` branch (ASP.NET Core / Blazor /
  worker via `.csproj` `Sdk=` + `PackageReference`); make `Flask`/`FastAPI`
  reachable from `pyproject.toml`.
- `MonorepoDetectorService`: recognise `.sln`/`.slnx` and uv/Poetry workspaces.
- Toolchain probe helper (`dotnet --version`) with a not-installed result the
  initializer skill can act on.
- Specs per detector change; a fixture workspace per profile.

## Batch 1b — C# AST support

**Agent**: backend-developer

- `scripts/copy-wasm.js:39-45` — add `tree-sitter-c-sharp.wasm` (already present
  in `@vscode/tree-sitter-wasm`, no new dependency).
- `ast.types.ts:25` — add `'csharp'` to `SupportedLanguage`.
- `tree-sitter.config.ts:11` — `.cs`/`.csx` in `EXTENSION_LANGUAGE_MAP`.
- `tree-sitter-parser.service.ts:113-135` — load + register the grammar; include
  the path in the init-failure message like the other four.
- `code-symbol-indexer.service.ts:107` — the duplicate extension switch.
  Consider collapsing it onto `EXTENSION_LANGUAGE_MAP` instead of extending it.
- **The real work**: C# queries reusing the shared capture names
  (`@function.name`, `@class.name`, `@import.source`, `@method.*`) so the
  extraction layer needs no change. Cover `method_declaration`,
  `constructor_declaration`, `local_function_statement`, `class_declaration`,
  `interface_declaration`, `struct_declaration`, `record_declaration`,
  `enum_declaration`, `property_declaration`, `using_directive`, and
  `namespace_declaration` in BOTH block and file-scoped form.
  `exportQuery: ''` (C# has no export statement).
- Decide and document the `partial` class policy (merge vs multiple entries).
- Specs: parse a representative C# file (records, file-scoped namespace, partial
  class, generic method, property) and assert extracted symbols.
- Verify `ptah_ast_analyze` and `ptah_code_search_symbols` return C# symbols;
  check whether `ptah-cli`/`ptah-tui` need the WASM copy step too.

## Batch 2 — External plugin marketplaces

**Agent**: backend-developer (+ frontend-developer for the consent UI)

- `MarketplaceRegistryService`: add/list/remove marketplaces by `owner/repo`
  (reuse `SAFE_SOURCE_PATTERN`), fetch + Zod-validate
  `.claude-plugin/marketplace.json`, cache with TTL.
- `ExternalPluginInstallerService`: download a plugin subtree into
  `~/.ptah/plugins/external/<marketplace>/<plugin>/`, atomic writes,
  path-traversal guard, record in an installed-plugins store — that record, NOT
  a wildcard, becomes the allowlist `KNOWN_PLUGIN_IDS` consults.
- `pruneStaleFiles` must treat `external/` as never owned by the bundled manifest.
- `downloadText` is UTF-8 only — either extend for binary assets or refuse and
  report which files were skipped.
- **Consent gate**: install shows skill count, whether the plugin ships
  `scripts/` or `mcpServers`, and the MCP command verbatim. No silent MCP
  registration. Per-plugin; re-prompt on version change.
- RPC (dual-registration): `plugins:list-marketplaces`, `:add-marketplace`,
  `:remove-marketplace`, `:install-external`, `:uninstall-external`.
- Marketplace UI: "Add marketplace" affordance + browse/install/uninstall on the
  existing `plugins` provider surface.
- Skill-name collision policy: namespace external skills, or surface the
  first-wins outcome to the user instead of a console warning.
- Seed `dotnet-agent-skills` (`dotnet/skills`) as a known-good marketplace.

## Batch 3 — `ptah-dotnet` glue plugin

**Agent**: technical-content-writer (+ backend-developer for registration)

- 3 skills: `dotnet-solution-initializer`, `dotnet-solution-architect`,
  `nx-dotnet-workspace`. Namespaced names; mandatory AskUserQuestion discovery
  matching the `saas-workspace-initializer` contract; explicit hand-off to
  `dotnet-template-engine` / `dotnet-test` / `dotnet-aspnetcore` by name.
- `nx-dotnet-workspace` documents `nx add @nx/dotnet`, the .NET SDK 8+
  requirement, the inferred-target table, the `--no-restore` gotcha, publish
  cache + `--runtime`, no cross-language edges (declare `implicitDependencies`),
  experimental status, and **when not to use Nx**.
- Generalize `saas-workspace-initializer` into the shared Stage A contract the
  per-stack initializers specialize — do not duplicate the roadmap format.
- Register: `.claude-plugin/plugin.json`, skills, `AVAILABLE_PLUGINS` entry,
  `npm run manifest:generate`, category label if a new category is introduced.
- Sync the `.claude` / `.agents` / `.github` mirrors.

## Batch 4 — Intake + routing through profiles

**Agent**: frontend-developer + backend-developer

- Intake gains a platform step before stack: Node/TypeScript · .NET · Python ·
  Other. Stack chips derive from `profile.stackOptions` — delete both hardcoded
  label mirrors.
- `NewProjectIntake` gains `platform`; Zod + TS parity; `data-testid`s for the
  new controls.
- `registerStartNewProject` enables `profile.requiredPlugins` (bundled +
  external, the latter installed through Batch 2 with consent) instead of the
  hardcoded `ptah-nx-saas`.
- `buildNewProjectSeedPrompt` becomes profile-driven: skill names from
  `profile.skills`, plus an Nx-decision instruction where `monorepoTool` is a
  question rather than a given.
- Toolchain-missing path: if `dotnet` is absent, say so with the install hint
  before scaffolding.

## Batch 5 — Verification

**Agents**: senior-tester, code-logic-reviewer, code-style-reviewer

- Playwright: .NET intake → observed RPC params carry `platform: 'dotnet'`;
  external-marketplace install consent dialog; profile-driven seed prompt.
- Unit: profile registry round-trips, detector fixtures per language, C# symbol
  extraction, marketplace manifest validation + traversal rejection, consent
  gating.
- Regression bar: the Node/TypeScript path behaves identically to
  TASK_2026_263's e2e suite (6 tests must stay green).
