---
name: dotnet-solution-architect
description: .NET solution and project layout from bounded contexts -- Clean Architecture vs vertical slices, project naming, ProjectReference direction rules, Central Package Management via Directory.Packages.props, Directory.Build.props for shared settings, global.json SDK pinning, and test project placement. Use when deriving the project/solution structure for a new .NET workspace or a new bounded context, or when a .csproj graph has grown tangled and needs a layout decision. Does not run dotnet new or any build/test command -- hand off execution to dotnet-template-engine and dotnet-test.
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

Both are valid; they solve different problems. Clean Architecture optimizes for protecting domain invariants across a long-lived codebase with real business rules. Vertical slices optimizes for shipping speed on features that are mostly request-in, response-out. Do not mix them within one bounded context -- mixing them within one solution (different contexts choosing differently) is fine and often correct.

### Clean Architecture layout (per bounded context)

```
src/
  Contoso.Orders.Domain/            # entities, value objects, domain events -- no outward references
  Contoso.Orders.Application/       # use cases, CQRS handlers, interfaces the domain needs
  Contoso.Orders.Infrastructure/    # EF Core, external service clients, implementations of Application interfaces
  Contoso.Orders.Api/               # controllers or minimal API endpoints, DI wiring, the only project with a Main/entry point
tests/
  Contoso.Orders.Domain.Tests/
  Contoso.Orders.Application.Tests/
  Contoso.Orders.Infrastructure.Tests/
```

### Vertical slices layout (per bounded context)

```
src/
  Contoso.Inventory/
    Features/
      AdjustStock/
        AdjustStockCommand.cs
        AdjustStockHandler.cs
        AdjustStockEndpoint.cs
      GetStockLevel/
        GetStockLevelQuery.cs
        GetStockLevelHandler.cs
        GetStockLevelEndpoint.cs
    Contoso.Inventory.csproj          # one project per bounded context, not per layer
tests/
  Contoso.Inventory.Tests/
    Features/
      AdjustStock/
      GetStockLevel/
```

See [references/clean-architecture-vs-vertical-slices.md](references/clean-architecture-vs-vertical-slices.md) for the full worked comparison, including where shared kernels and cross-context contracts live in each shape.

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

## Central Package Management (`Directory.Packages.props`)

One version per package, declared once at the solution root, referenced by every `.csproj` without a version attribute. This is what stops the drift where three projects in one solution reference three different `Microsoft.Extensions.*` versions.

```xml
<!-- Directory.Packages.props (solution root) -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Microsoft.EntityFrameworkCore" Version="8.0.8" />
    <PackageVersion Include="xunit" Version="2.9.0" />
  </ItemGroup>
</Project>
```

Individual `.csproj` files then reference packages without a version:

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.EntityFrameworkCore" />
</ItemGroup>
```

## `Directory.Build.props` (shared settings)

One file at the solution root, MSBuild auto-imports it into every project below. This is where target framework, nullable, and analyzer settings live so they are declared once instead of copy-pasted into every `.csproj`.

```xml
<!-- Directory.Build.props (solution root) -->
<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
```

## `global.json` (SDK pinning)

Pins the .NET SDK version the whole solution builds against, so a machine with a newer SDK installed does not silently roll a CI-passing solution onto an untested toolchain.

```json
{
  "sdk": {
    "version": "8.0.100",
    "rollForward": "latestFeature"
  }
}
```

See [references/central-package-management.md](references/central-package-management.md) for the full baseline (all three files together, plus what to do when a single package genuinely needs a per-project override).

## Test Project Placement

- Mirror `src/` under `tests/`: one test project per production project (Clean Architecture) or per bounded context (vertical slices), named `<ProductionProject>.Tests`.
- Test projects reference the production project under test via `ProjectReference`, never the other way around.
- This skill places the test projects and wires their `ProjectReference`; it does not choose the test framework (that is `dotnet-solution-initializer` Round 2) or scaffold the test project itself -- hand that off to `dotnet-test`.

## Handoff boundary

This skill produces: the project list, the layout tree, `Directory.Packages.props`, `Directory.Build.props`, and `global.json`. It hands the project list to `dotnet-template-engine`'s `template-instantiation` skill to actually run `dotnet new` / `dotnet sln add` / `dotnet add reference`, and hands the test project list to `dotnet-test` to scaffold and wire the chosen framework. Never run those commands from within this skill.

## References

- [references/clean-architecture-vs-vertical-slices.md](references/clean-architecture-vs-vertical-slices.md) -- full comparison, shared-kernel placement, worked example per shape
- [references/central-package-management.md](references/central-package-management.md) -- complete `Directory.Packages.props` / `Directory.Build.props` / `global.json` baseline and per-project override escape hatch

### Companion skills

- [dotnet-solution-initializer](../dotnet-solution-initializer/SKILL.md) -- invokes this skill in Step a2
- [nx-dotnet-workspace](../nx-dotnet-workspace/SKILL.md) -- Nx wraps this layout's projects once `ProjectReference` inference is set up; does not change the layout itself
- `ddd-architecture` (ptah-core plugin) -- supplies the bounded contexts this skill lays out
- `dotnet-template-engine`, skill `template-instantiation` (dotnet/skills marketplace) -- executes the layout this skill designs
- `dotnet-test` (dotnet/skills marketplace) -- scaffolds and wires the test projects this skill places
