---
name: nx-dotnet-workspace
description: The Nx-or-not decision and @nx/dotnet mechanics for .NET workspaces -- nx add @nx/dotnet, the Nx 22+ and .NET SDK 8.0+ requirements, project inference from csproj/fsproj/vbproj (not sln), the inferred-target table, the --no-restore default, publish cache correctness with --runtime, no cross-language .NET-to-TypeScript graph edges, experimental status, and when NOT to use Nx at all. Use when dotnet-solution-initializer's Round 2 asks whether the workspace should be Nx-managed, or when adding Nx to an existing .NET repo, or debugging an Nx target that is missing or misbehaving for a .NET project.
---

# Nx + .NET Workspace

Decides whether a .NET workspace should be Nx-managed, and if so, documents exactly what `@nx/dotnet` does and does not do. This skill does not design the solution layout (`dotnet-solution-architect` does that) and does not run `dotnet new` (`dotnet-template-engine` does that) -- it is the layer in between: given a layout that already exists or is about to exist, should Nx wrap it, and what should the user expect once it does.

## The decision: ask, default to Nx

`dotnet-solution-initializer` Round 2 asks this as an explicit `AskUserQuestion` -- Yes / No / Recommend for me. If the `AskUserQuestion` tool is unavailable in this harness, put the same three choices to the user in plain text and wait for the answer before continuing. This skill supplies the recommendation logic; it never silently picks for the user and Round 2 never skips the question.

| Situation                                                                                                           | Recommend                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Multiple bounded contexts / multiple projects that need `nx affected`, cross-project caching, or a dependency graph | Yes                                                                                                              |
| Mixed .NET + frontend solution (a .NET API alongside an Angular/React app in the same repo)                         | Yes                                                                                                              |
| Single service, one solution, one deployable                                                                        | No -- plain `dotnet new sln` is simpler and has nothing to debug when it misbehaves                              |
| Team has no existing Node/npm tooling and no interest in acquiring any                                              | No -- `@nx/dotnet` still requires Node to run Nx itself, even though it never touches .NET-vs-TS build mechanics |
| Team has no interest in a mixed workspace ambition (never plans to add a frontend or another service)               | No                                                                                                               |

Never force either answer. When the user picks "Recommend for me," give the one-sentence rationale from whichever row applied before moving on.

## Prerequisites

- **Nx >= 22.0.0.** (Nx 23.1.1 is the latest as of this skill's authoring and also satisfies it. Check the Nx version in your own workspace before assuming the plugin is available.)
- **.NET SDK 8.0+.** `@nx/dotnet` ships a compiled `MsbuildAnalyzer` that uses `Microsoft.Build.Locator`, which needs the 8.0 SDK at minimum regardless of which target framework the projects themselves build against. Pin the SDK via `global.json` (see `dotnet-solution-architect`'s Central Package Management reference) so this requirement is enforced in CI, not just on one developer's machine.

## Installation

```bash
# Existing Nx workspace, adding .NET support
nx add @nx/dotnet

# Existing .NET repo, adding Nx
nx init
```

`nx add` on an existing Nx workspace is the common case for the mixed .NET+frontend scenario. `nx init` inside an existing .NET repo is the common case when a single-service .NET repo later grows a second project and the team wants Nx's affected/graph/caching without starting a new workspace from scratch.

## Project inference: `.csproj`/`.fsproj`/`.vbproj`, NOT `.sln`

`@nx/dotnet` infers Nx projects from project files, never from the solution file:

```
**/{*.{csproj,fsproj,vbproj},Directory.Build.{props,targets},Directory.Solution.{props,targets},Directory.Packages.props}
```

This matters concretely: a `.sln` that lists twenty projects is not itself scanned, so a solution-only workspace with no project files anywhere reads as having zero Nx projects, not twenty. If a project exists on disk but is missing from every `.sln`, Nx still infers it (because the `.csproj` is what it looks at) -- the reverse of what most .NET tooling assumes. Any tooling that probes for `.sln` alone will report a real solution workspace as "empty" -- probe for project files instead.

## Inferred targets

| Target    | Applies to                     | Notes                                                                             |
| --------- | ------------------------------ | --------------------------------------------------------------------------------- |
| `build`   | every inferred project         |                                                                                   |
| `clean`   | every inferred project         |                                                                                   |
| `restore` | every inferred project         | not run automatically before other targets -- see the `--no-restore` gotcha below |
| `test`    | test projects                  | detected via the project's own test-SDK package reference                         |
| `publish` | projects with `OutputType=Exe` | see the `--runtime` cache gotcha below                                            |
| `run`     | projects with `OutputType=Exe` |                                                                                   |
| `pack`    | library projects               |                                                                                   |
| `watch`   | every inferred project         | continuous, not cached                                                            |

Nothing else is inferred. **No `serve` target, no `format` target** -- both must be hand-configured in `project.json`/`nx.json` if the team wants them (`serve` typically wraps `dotnet watch run`; `format` wraps `dotnet format`).

## Gotchas

- **`--no-restore` is the default.** Every inferred target other than `restore` itself passes `--no-restore`, which means a clean checkout (or a CI runner with a cold NuGet cache) needs an explicit `restore` run first -- `nx run-many -t restore` or `dotnet restore` at the solution root -- before `build`/`test`/`publish` will succeed. This is the single most common "why did the build fail" report on a fresh clone.
- **`publish` cache correctness with `--runtime`.** Passing `--runtime <rid>` (e.g. `--runtime linux-x64`) changes the output of `publish` but is not always reflected correctly in what Nx treats as cache inputs -- a cached `publish` result for one runtime identifier can be served back for a different one. Pass `--runtime` explicitly and verify the output directory before trusting a cache hit on a runtime-specific publish, especially in a CI matrix that publishes multiple RIDs.
- **Configuration-scoped `dependsOn` is rough.** `dependsOn` entries that should only apply for a specific build configuration (Debug vs Release) do not consistently scope the way they do for other Nx language plugins. Verify generated `dependsOn` behaviour per configuration rather than assuming parity with `@nx/js`.
- **Undocumented `build:release` target.** Some `@nx/dotnet` versions synthesize a `build:release` target with no corresponding documentation. Treat it as unstable API, not a load-bearing part of a pipeline.

## No cross-language `.NET <-> TypeScript` graph edges

Dependency edges come from `<ProjectReference>` only, so `nx affected` and `nx graph` see `.NET`-to-`.NET` edges correctly but have zero visibility into a .NET API calling a TypeScript-built client SDK, or a frontend app that consumes a .NET API's OpenAPI contract. In a mixed .NET+frontend Nx workspace, declare those relationships manually:

```json
// apps/orders-api/project.json
{
  "implicitDependencies": ["orders-frontend-client"]
}
```

Without this, `nx affected` will not rebuild/retest the frontend when the .NET API's contract changes, and vice versa -- silently, since nothing errors, the graph simply omits the edge.

## No code generators

By design, `@nx/dotnet` ships only `init` and `ci-workflow` generators. There is no `nx g @nx/dotnet:lib` equivalent to `@nx/js:lib`. Scaffolding a new project is `dotnet new` / `dotnet add`, run through `dotnet-template-engine`'s `template-instantiation` skill (see `dotnet-solution-initializer`) -- never invent a generator call that does not exist.

## Experimental status

`@nx/dotnet` is officially marked **EXPERIMENTAL** ([nrwl/nx#35837](https://github.com/nrwl/nx/issues/35837)) despite the Nx 22 release marketing presenting it as a first-class technology. Say this plainly when recommending it -- "experimental" here means the rough edges above (configuration-scoped `dependsOn`, publish cache correctness, undocumented targets) are known and open, not hypothetical. Offer `@nx/dotnet`, never force it, and always mention the plain-`dotnet-new-sln` alternative in the same breath for a single-service workspace.

## `@nx-dotnet/core` is archived — never recommend it

The community package `@nx-dotnet/core` predates `@nx/dotnet` and is now archived and deprecated by its maintainers. Even though it may still appear in search results or older tutorials, do not suggest it under any circumstance -- `@nx/dotnet` (the official, `@nx`-scoped package) is the only supported path.

## Debugging

Set `NX_DOTNET_DISABLE=true` to disable the plugin's project inference entirely -- useful for isolating whether an Nx graph problem originates from `@nx/dotnet`'s inference or from something else in the workspace configuration.

## When NOT to use Nx

Say plainly that Nx is unnecessary, not just "optional," in these cases:

- **Single service.** One solution, one deployable, no `nx affected`/caching win to claim. Plain `dotnet new sln` plus normal `dotnet build`/`dotnet test` is simpler and has no experimental-plugin surface to debug.
- **Team with no Node tooling.** Nx itself runs on Node regardless of what languages it orchestrates. A team with zero npm/Node in its toolchain today, and no plan to acquire any, takes on that dependency purely to wrap `dotnet build` -- a cost with no corresponding benefit for a single-language, single-project repo.
- **No interest in a mixed workspace.** Nx's main value for .NET is coordinating a polyglot repo (multiple .NET projects, or .NET plus a frontend) through one graph, one cache, one `affected` command. A team that will never add a second project or a frontend to this repo is not the audience Nx was built for here.

In every "when NOT to use" case, the honest recommendation is plain `dotnet new sln` -- name it explicitly rather than leaving the user to infer the non-Nx alternative.

## References

- [dotnet-solution-initializer](../dotnet-solution-initializer/SKILL.md) -- asks the Nx question in Round 2 and invokes this skill for the recommendation
- [dotnet-solution-architect](../dotnet-solution-architect/SKILL.md) -- designs the project layout Nx then wraps; this skill does not change that layout
- `dotnet-template-engine`, skill `template-instantiation` (dotnet/skills marketplace) -- scaffolds the projects `@nx/dotnet` will infer targets for
