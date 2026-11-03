---
name: dotnet-solution-architect
description: Derives .NET solution and project layout from bounded contexts — Clean Architecture vs vertical slices, project references, shared build settings, test placement. Use when designing or untangling the project layout of a .NET solution or bounded context. Not for initializing a workspace — use dotnet-solution-initializer.
---

# .NET Solution Architect

Turns bounded contexts (from `ddd-architecture`) and Round 2 stack answers (from `dotnet-solution-initializer`) into a concrete solution and project layout. This is the .NET equivalent of `nx-workspace-architect`'s lib-layout role -- it decides shape, naming, and dependency direction; it does not run `dotnet new`, `dotnet add package`, or any build/test command itself.

## Activation scope

Activates twice, mirroring `nx-workspace-architect`'s pattern: once in `dotnet-solution-initializer` Step a2 (derives the initial solution layout from discovery + bounded contexts, before scaffolding), and again per-module during Stage B when a new bounded context needs its own project set, or an existing layout needs a boundary fix.

## Core Principle: Bounded Context -> Project Set, Not File Folder

A bounded context from `ddd-architecture` becomes one **set of projects**, not one project. The split (how many projects per context) is exactly the Clean Architecture vs vertical slices decision below -- everything else in this skill follows from that one choice.

## Decision: Clean Architecture vs Vertical Slices

| Signal from discovery                                                            | Fits                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple bounded contexts, each with real domain logic and invariants to protect | Clean Architecture (layered)                                                                                                                                                                      |
| Team is new to DDD-in-.NET and wants a well-known, widely-documented shape       | Clean Architecture (layered)                                                                                                                                                                      |
| Single bounded context, or a context that is mostly CRUD/orchestration           | Vertical slices (feature-folder)                                                                                                                                                                  |
| App shape = Minimal API and the team explicitly wants low ceremony               | Vertical slices (feature-folder)                                                                                                                                                                  |
| Round 2 "Recommend for me" on architecture, no other signal                      | Clean Architecture -- it is the safer default when bounded contexts genuinely have logic to protect; vertical slices trades that protection for less ceremony, so it should be an explicit choice |

Do not mix the two shapes within one bounded context's projects; different bounded contexts in one solution choosing differently is fine and often correct. The full trade-off comparison, the per-shape project layouts, and where shared kernels and cross-context contracts live in each shape are worked in [references/clean-architecture-vs-vertical-slices.md](references/clean-architecture-vs-vertical-slices.md) -- load it whenever a layout is being derived.

## Project Naming

`<Company>.<Product>.<BoundedContext>[.<Layer>]` -- the same segments `ddd-architecture` already produced (product, bounded context) plus the layer suffix Clean Architecture needs. Vertical-slices projects drop the layer suffix entirely, since there is only one project per context.

- Test projects: `<same name>.Tests`, one test project per production project in Clean Architecture, one per bounded context in vertical slices.
- Shared/contract projects (types every context can reference): `<Company>.<Product>.SharedKernel` -- keep this project anemic (types and interfaces only, no behaviour) or it becomes the coupling point that defeats bounded contexts in the first place.

## `ProjectReference` Direction Rules

Dependencies point inward, never outward, and never sideways between bounded contexts without going through a contracts project:

```
Api / Web  ──▶  Infrastructure  ──▶  Application  ──▶  Domain
   │                                      ▲
   └──────────────────────────────────────┘
        (Api may reference Application directly for simple cases)

Domain          references nothing in this solution
Application     references Domain only
Infrastructure  references Application and Domain
Api             references Infrastructure and Application
```

Rules that hold regardless of layout:

1. **No circular `ProjectReference`.** MSBuild will refuse to build a cycle, but the earlier the layout prevents one, the cheaper the fix.
2. **`Domain` (or the vertical-slices project's core types) has zero outward references** -- not even to `Application`. This is what makes the domain layer testable without infrastructure.
3. **Cross-bounded-context references go through a contracts/shared-kernel project, never context-to-context directly.** `Contoso.Orders` referencing `Contoso.Inventory.Domain` directly is the layout smell that means the bounded-context split from `ddd-architecture` was not actually honoured in the code.
4. **Test projects reference exactly the production project(s) under test**, never a sibling test project.

## Solution-Root Files

Three files at the solution root apply solution-wide via MSBuild's automatic directory-walk import, so each setting is declared once instead of copy-pasted into every `.csproj`:

- `Directory.Packages.props` -- Central Package Management: one version per package, declared once, referenced by every `.csproj` without a `Version` attribute.
- `Directory.Build.props` -- target framework, nullable, and analyzer settings for every project.
- `global.json` -- pins the .NET SDK the whole solution builds against, so a machine with a newer SDK installed does not silently roll a CI-passing solution onto an untested toolchain.

The complete baseline for all three files, plus what to do when a single package genuinely needs a per-project override, is in [references/central-package-management.md](references/central-package-management.md) -- load it when writing any of the three.

## Test Project Placement

- Mirror `src/` under `tests/`: one test project per production project (Clean Architecture) or per bounded context (vertical slices), named `<ProductionProject>.Tests`.
- Test projects reference the production project under test via `ProjectReference`, never the other way around.
- This skill places the test projects and wires their `ProjectReference`; it does not choose the test framework (that is `dotnet-solution-initializer` Round 2) or scaffold the test project itself -- hand that off to `dotnet-test`.

## Handoff boundary

This skill produces: the project list, the layout tree, `Directory.Packages.props`, `Directory.Build.props`, and `global.json`. It hands the project list to `dotnet-template-engine`'s `template-instantiation` skill to actually run `dotnet new` / `dotnet sln add` / `dotnet add reference`, and hands the test project list to `dotnet-test` to scaffold and wire the chosen framework. Never run those commands from within this skill. `nx-dotnet-workspace` may wrap the resulting projects for Nx targets once `ProjectReference` inference is set up; it does not change the layout itself.

## References

- [references/clean-architecture-vs-vertical-slices.md](references/clean-architecture-vs-vertical-slices.md) -- full trade-off comparison, shared-kernel placement, worked layout per shape. Load when choosing or deriving a layout.
- [references/central-package-management.md](references/central-package-management.md) -- complete `Directory.Packages.props` / `Directory.Build.props` / `global.json` baseline and the per-project override escape hatch. Load when writing any solution-root file.