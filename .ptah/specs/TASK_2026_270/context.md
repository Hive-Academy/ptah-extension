# TASK_2026_270 — Stack Profiles: multi-language New Project, first-class .NET

## User intent (2026-08-17)

Follow-on from TASK_2026_263. New Project now asks the user what they are
building, but every path below the intake assumes Nx + NestJS + Angular/React.
The ask: first-class .NET support, built on an architecture that makes Python —
or any language — an out-of-the-box addition rather than a second special case.
Two reference points supplied by the user: `github.com/dotnet/skills` and
`nx.dev/docs/technologies/dotnet/introduction`. After the effort estimate came
back small, C# AST support was folded in as Batch 1b.

## Decisions taken (user, 2026-08-17)

1. **External marketplace support** — generalize the plugin loader to install
   from any GitHub repo exposing `.claude-plugin/marketplace.json`. Not vendoring
   a curated subset. Requires a trust/consent story.
2. **Ask, default to Nx** — discovery asks whether the workspace should be
   Nx-managed. Default yes for multi-project or mixed .NET+frontend solutions,
   no for a single service. Never force it.
3. **C# AST is in scope** — folded in as Batch 1b rather than deferred.

## Research findings (verified 2026-08-17)

### @nx/dotnet — official, works, experimental

- Package `@nx/dotnet`, requires Nx >= 22.0.0 (repo is on 22.6.5; latest 23.1.1
  published 2026-07-30). `nx add @nx/dotnet` on an existing workspace; `nx init`
  inside an existing .NET repo.
- Infers projects from `**/{*.{csproj,fsproj,vbproj},Directory.Build.{props,targets,rsp},
Directory.Solution.{props,targets},Directory.Packages.props}` — **no `.sln`
  scanning**; project files are the inference unit. Requires .NET SDK 8.0+
  (ships a compiled `MsbuildAnalyzer` using `Microsoft.Build.Locator`).
- Inferred targets: `build`/`clean`/`restore` (all), `test` (test projects),
  `publish`/`run` (OutputType=Exe), `pack` (libraries), `watch` (all, continuous).
  No `serve`, no `format` — must be hand-configured.
- Dependency edges come from `<ProjectReference>` only. `nx affected` works for
  .NET. **No cross-language (.NET <-> TS) edge inference** — declare
  `implicitDependencies` manually.
- **No code generators** by design (only `init` and `ci-workflow`). Scaffolding
  defers to `dotnet new` / `dotnet add`.
- Officially experimental despite v22 marketing (nrwl/nx#35837). Known rough
  edges: configuration-scoped `dependsOn`, `publish` cache correctness with
  `--runtime`, no auto-`restore` (`--no-restore` passed by default), undocumented
  `build:release`. `NX_DOTNET_DISABLE=true` kills the plugin.
- `@nx-dotnet/core` (community) is archived and deprecated — never recommend it.
- Python has no first-party Nx plugin; `@nxlv/python` (uv/Poetry) is the
  community equivalent.

### dotnet/skills — Microsoft, MIT, consume don't rewrite

- 5,173 stars, MIT (".NET Foundation and Contributors"), officially maintained
  (CODEOWNERS-gated), pushed daily.
- 16 plugins under `plugins/`: dotnet, dotnet-advanced, dotnet-ai,
  dotnet-aspnetcore, dotnet-blazor, dotnet-data, dotnet-diag, dotnet-experimental,
  dotnet-maui, dotnet-msbuild, dotnet-nuget, dotnet-template-engine, dotnet-test,
  dotnet-test-migration, dotnet-upgrade, dotnet11.
- Layout per plugin: `plugin.json` + `.codex-plugin/plugin.json`
  (+ `.claude-plugin/plugin.json` where fields diverge), `version.json`,
  `skills/<name>/SKILL.md` (+ `references/`, `scripts/`, `assets/`),
  `agents/<name>.agent.md` (5 of 16 plugins). No `commands/`.
- SKILL.md frontmatter: `name`, `description` (block scalar, "USE FOR: ... DO NOT
  USE FOR: ..."), `license: MIT`. No `allowed-tools`. **No `AskUserQuestion`
  anywhere** — clarification is prose ("ask before scaffolding").
- Four parallel marketplace manifests kept identical: `.claude-plugin/`,
  `.agents/plugins/`, `.cursor-plugin/`, `.github/plugin/`. Manifest name
  `dotnet-agent-skills`; entries are `{ name, source: './plugins/<id>',
description, mcpServers? }`.
- `dotnet-msbuild` ships an MCP server (`Microsoft.AITools.BinlogMcp` via
  `dotnet dnx`); several plugins ship PowerShell/Python/C# scripts. **This is the
  consent surface.**
- `dotnet-template-engine` is the scaffolding plugin (orchestrator agent +
  6 skills) — its workflow already asks clarifying questions and runs
  `dotnet new --dry-run` before committing.

### C# AST — cheaper than assumed

- `scripts/copy-wasm.js` copies grammars from `@vscode/tree-sitter-wasm` (0.3.1).
  That package **already ships `tree-sitter-c-sharp.wasm`** alongside the four we
  use — plus java, rust, ruby, php, cpp, bash, powershell. No grammar build, no
  new dependency, no license question.
- Change set: `copy-wasm.js:44` (1 line), `ast.types.ts:25` union (1 line),
  `EXTENSION_LANGUAGE_MAP` in `tree-sitter.config.ts:11` (2 lines), grammar load
  in `tree-sitter-parser.service.ts:113-135` (~4 lines), and the **duplicate**
  extension switch in `code-symbol-indexer.service.ts:107` (2 lines).
- The real work is the query set (~60 lines). Python/Go deliberately "reuse the
  JS/TS capture names so the extraction layer is shared" — matching
  `@function.name` / `@class.name` / `@import.source` means `AstAnalysisService`,
  the symbol indexer, `ptah_ast_analyze`, `ptah_code_search_symbols` and context
  enrichment all work with no further changes.
- `copy-wasm` runs for `ptah-extension-vscode`, `ptah-electron` and
  `ptah-electron-e2e` — **not** `ptah-cli`/`ptah-tui`. Confirm whether those
  surface AST features before treating that as a gap.

### Ptah infra — where the walls are

- `plugin-loader.service.ts:51` `AVAILABLE_PLUGINS` is a hardcoded 5-entry array;
  `:143` `KNOWN_PLUGIN_IDS` derives from it and is a security allowlist rejecting
  any other id. Only `ptah-harness-*` directories are dynamically discovered.
  **No third-party/remote plugin source exists.**
- `content-download.service.ts:79` hardcodes ONE manifest URL
  (`Hive-Academy/ptah-extension/main/content-manifest.json`). No override.
  `pruneStaleFiles` (`:287`) deletes manifest-owned subtrees — sideloaded plugin
  dirs survive only while their id is absent from the manifest.
- `skill-junction.service.ts` — flat global skill namespace, first-plugin-wins on
  collision (`:444-458`), warning only. Commands are copied on Windows with a
  `.ptah-managed.json` ownership manifest. Agents are NOT junctioned here.
- Marketplace UI (`libs/frontend/marketplace/providers.registry.ts:18`) has six
  providers; the `plugins` surface is only the bundled enable/disable modal —
  there is no `plugins:install` RPC at all. `skillsSh:install` shells
  `npx skills add <owner/repo>` (validated by `SAFE_SOURCE_PATTERN`) but the UI
  exposes no free-text source field.
- **Five uncoordinated language detectors**:
  1. `ProjectDetectorService` — richest; already knows `.csproj`/`.fsproj`/`.sln`
     and `pyproject.toml`/`requirements.txt`/`setup.py`/`Pipfile`. Root-only, no
     recursion, no `.vbproj`/`.slnx`/`global.json`.
  2. `FrameworkDetectorService` — no `ProjectType.DotNet` branch at all; Python is
     Django-only; `Framework.Flask`/`FastAPI` declared but never returned.
  3. `MonorepoDetectorService` — JS-only; a 20-project `.sln` reports
     `isMonorepo: false`.
  4. `HarnessWorkspaceContextService` — **what the harness actually uses**;
     `:110-121` probes only `requirements.txt`/`go.mod`/`Cargo.toml`. A .NET repo
     renders `Languages: (none detected)` into the agent prompt. Its sibling
     `isWorkspaceEffectivelyEmpty()` (`:129-207`) DOES know `.cs`/`pyproject.toml`
     but not `.csproj`/`.sln` — so a solution-only workspace reads as **empty**
     and takes the new-project branch on an existing solution.
  5. `SkillsShRpcHandlers.detectTechnologies` (`:659-726`) — no Python, no .NET.
- Intake vocabulary is mirrored in two places that must not drift:
  `harness-constants.ts:14` `STACK_LABELS` (backend) and
  `new-project-intake.ts:24` `NEW_PROJECT_STACK_OPTIONS` (frontend).
- `buildNewProjectSeedPrompt` (`harness-constants.ts:67`) hardcodes three
  TypeScript-only skill names; `registerStartNewProject`
  (`harness-rpc.handlers.ts:600`) hardcodes one plugin id. Everything downstream
  (junctions, broadcast, dispose) is already generic.

## Target architecture

### StackProfile — the one descriptor

```ts
export interface StackProfile {
  id: 'node-ts' | 'dotnet' | 'python';
  label: string;
  detect: { manifests: string[]; globs: string[]; sourceExtensions: string[] };
  toolchain: { probe: string; minVersion: string; installHint: string };
  workspace: {
    monorepoTool: 'nx' | 'none';
    nxPlugins: string[];
    scaffoldCommands: string[];
  };
  skills: { initializer: string; architect: string; domain: 'ddd-architecture' };
  requiredPlugins: PluginRef[]; // bundled id | { marketplace, plugin }
  stackOptions: { value: string; label: string }[]; // intake chips
}
```

Single source of truth for: intake vocabulary (both mirrors derive from it),
plugin routing, seed-prompt skill names, and every language detector.

### Division of labour with dotnet/skills

- **Ptah owns**: discovery (mandatory AskUserQuestion), domain modelling,
  `.ptah/roadmap.md` contract, solution/library layout, Nx integration decision.
- **Microsoft owns**: `dotnet new` execution, test running, EF/data, MSBuild,
  NuGet, ASP.NET Core, Blazor, diagnostics, upgrades.
- `ptah-dotnet` glue plugin, 3 skills: `dotnet-solution-initializer` (Stage A),
  `dotnet-solution-architect` (Clean Architecture vs vertical slices, CPM via
  `Directory.Packages.props`, `ProjectReference` rules), `nx-dotnet-workspace`.
  Hands off to Microsoft's skills by name.

### Nx posture

Discovery asks. Default Nx for multi-project or mixed .NET+frontend; plain
`dotnet new sln` for a single service. `nx-dotnet-workspace` must document the
experimental-status caveats and the `--no-restore` / publish-cache gotchas.

## Risks to carry into implementation

1. `@nx/dotnet` is experimental — offer, never force; encode workarounds.
2. Flat skill namespace — external plugin skills need namespacing or a collision
   policy stronger than first-wins-with-a-warning.
3. External plugins ship executable scripts and an MCP server — installation
   needs explicit user consent showing what will be installed, and
   `KNOWN_PLUGIN_IDS` must stay a real boundary (allowlist by installed record,
   not by wildcard).
4. `pruneStaleFiles` must never delete externally-installed plugin trees.
5. C# `partial` classes split across files will produce multiple symbol-index
   entries for one type — decide merge vs accept, do not discover it in the wild.
6. Bundle size: five WASM grammars instead of four in every shipped artifact.
   Check the marketplace VSIX limit.
