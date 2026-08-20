# Development Tasks — TASK_2026_267

**Batches**: 5 | **Branch**: TBD | **Decomposed**: 2026-08-17

Sequencing note: batches 1 and 2 are independent and can run in parallel.
Batch 3 needs 1. Batch 4 needs 1+2+3. Batch 5 is last.

---

## Batch 1 — StackProfile registry + detection unification

**Agent**: backend-developer

- New lib or `libs/shared` module owning `StackProfile` + the `STACK_PROFILES`
  registry (`node-ts`, `dotnet`, `python`). Zero-dep, importable by both sides.
- `node-ts` profile must reproduce today's behaviour exactly (regression bar).
- Rewire `HarnessWorkspaceContextService.resolveWorkspaceContext` and
  `isWorkspaceEffectivelyEmpty` to read `detect` from the registry — fixes
  `Languages: (none detected)` on .NET repos and the solution-only-reads-as-empty
  bug in one move.
- Point `ProjectDetectorService` at the same table; add `.vbproj`, `.slnx`,
  `global.json`, `Directory.Build.props`, `uv.lock`, `poetry.lock`.
- `FrameworkDetectorService`: add a `DotNet` branch (ASP.NET Core / Blazor /
  worker via `.csproj` `Sdk=` + `PackageReference`); make `Flask`/`FastAPI`
  reachable from `pyproject.toml`.
- `MonorepoDetectorService`: recognise `.sln`/`.slnx` and uv/Poetry workspaces.
- Toolchain probe helper (`dotnet --version` etc.) with a not-installed result
  the initializer skill can act on.
- Specs for every detector change; a fixture workspace per profile.

## Batch 2 — External plugin marketplaces

**Agent**: backend-developer (+ frontend-developer for the consent UI)

- `MarketplaceRegistryService`: add/list/remove marketplaces by `owner/repo`
  (reuse `SAFE_SOURCE_PATTERN`), fetch + Zod-validate
  `.claude-plugin/marketplace.json`, cache with TTL.
- `ExternalPluginInstallerService`: download a plugin subtree into
  `~/.ptah/plugins/external/<marketplace>/<plugin>/`, atomic writes, path-traversal
  guard, record in an installed-plugins store (this record — NOT a wildcard —
  becomes the allowlist that `KNOWN_PLUGIN_IDS` consults).
- `pruneStaleFiles` must treat `external/` as never-owned by the bundled manifest.
- Binary/script awareness: `downloadText` is UTF-8 only — either extend for
  binary or refuse and report.
- **Consent gate**: install shows what lands — skill count, whether the plugin
  ships `scripts/` or `mcpServers`, and the MCP server command verbatim. No
  silent MCP registration. Per-plugin, re-prompt on version change.
- RPC: `plugins:list-marketplaces`, `plugins:add-marketplace`,
  `plugins:remove-marketplace`, `plugins:install-external`,
  `plugins:uninstall-external` (dual-registration rule).
- Marketplace UI: extend the `plugins` provider surface with an "Add marketplace"
  affordance + browse/install/uninstall for external plugins.
- Skill-name collision policy: namespace external skills or make the
  first-wins outcome visible to the user rather than a console warning.
- Seed `dotnet-agent-skills` (`dotnet/skills`) as a known-good marketplace.

## Batch 3 — `ptah-dotnet` glue plugin

**Agent**: technical-content-writer (+ backend-developer for registration)

- 3 skills: `dotnet-solution-initializer`, `dotnet-solution-architect`,
  `nx-dotnet-workspace`. Namespaced names; mandatory AskUserQuestion discovery
  matching the `saas-workspace-initializer` contract; explicit hand-off to
  `dotnet-template-engine` / `dotnet-test` / `dotnet-aspnetcore` by name.
- `nx-dotnet-workspace` documents: `nx add @nx/dotnet`, .NET SDK 8+ requirement,
  inferred-target table, `--no-restore` gotcha, publish cache + `--runtime`,
  no cross-language edges (declare `implicitDependencies`), experimental status,
  and **when not to use Nx**.
- Generalize `saas-workspace-initializer` into the shared Stage A contract the
  per-stack initializers specialize (do not duplicate the roadmap format).
- Register per §3d of context: `.claude-plugin/plugin.json`, skills,
  `AVAILABLE_PLUGINS` entry, `npm run manifest:generate`, category label if new.
- Sync the `.claude` / `.agents` / `.github` mirrors.

## Batch 4 — Intake + routing through profiles

**Agent**: frontend-developer + backend-developer

- Intake gains a platform step before stack: Node/TypeScript · .NET · Python ·
  Other. Stack chips derive from `profile.stackOptions` — delete both hardcoded
  label mirrors.
- `NewProjectIntake` gains `platform`; Zod + TS parity; `data-testid`s for the
  new controls.
- `registerStartNewProject` enables `profile.requiredPlugins` (bundled +
  external, installing the latter through Batch 2 with consent) instead of the
  hardcoded `ptah-nx-saas`.
- `buildNewProjectSeedPrompt` becomes profile-driven: skill names from
  `profile.skills`, plus an Nx-decision instruction for stacks where
  `monorepoTool` is a question rather than a given.
- Toolchain-missing path: if `dotnet` is absent, say so with the install hint
  before scaffolding.

## Batch 5 — Verification

**Agents**: senior-tester, code-logic-reviewer, code-style-reviewer

- Playwright: .NET intake → observed RPC params carry `platform: 'dotnet'`;
  external-marketplace install consent dialog; profile-driven seed prompt.
- Unit: profile registry round-trips, detector fixtures per language,
  marketplace manifest validation + traversal rejection, consent gating.
- Regression bar: the Node/TypeScript path behaves byte-identically to
  TASK_2026_263's e2e suite.
