# Central Package Management — Full Baseline

The three files below live at the solution root (next to the `.sln`/`.slnx`) and apply to every project underneath via MSBuild's automatic directory-walk import -- no per-project wiring required beyond what is shown.

## `Directory.Packages.props`

```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <!-- Fails the build instead of silently allowing a project to declare its own
         version, which is the exact drift CPM exists to prevent. -->
    <CentralPackageVersionOverrideEnabled>false</CentralPackageVersionOverrideEnabled>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Microsoft.EntityFrameworkCore" Version="8.0.8" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore.SqlServer" Version="8.0.8" />
    <PackageVersion Include="Microsoft.AspNetCore.OpenApi" Version="8.0.8" />
    <PackageVersion Include="xunit" Version="2.9.0" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="2.8.2" />
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="17.11.1" />
  </ItemGroup>
</Project>
```

Every `.csproj` in the solution then omits the `Version` attribute entirely:

```xml
<ItemGroup>
  <PackageReference Include="Microsoft.EntityFrameworkCore" />
</ItemGroup>
```

### Per-project override escape hatch

`CentralPackageVersionOverrideEnabled = false` above blocks the common failure mode (a project quietly pinning its own version and nobody noticing). When one project genuinely needs a different version than the rest of the solution -- a legacy project stuck on an older major version during a migration, say -- the two honest options are:

1. Flip `CentralPackageVersionOverrideEnabled` to `true` for the whole solution and accept that any project can now override any version (loses the "one version, guaranteed" property for everyone, not just the one project).
2. Extract that project to its own solution/repo if it is diverging enough to need independent versioning -- often the more honest signal is that the project no longer belongs in this solution.

Do not silently disable CPM for one project via `<PackageReference Include="X" Version="Y" />` while `CentralPackageVersionOverrideEnabled` stays `false` -- that fails the build by design, and routing around it defeats the whole point.

## `Directory.Build.props`

```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
  </PropertyGroup>
</Project>
```

Test projects that need to relax a rule (e.g. `CS8602` nullable warnings on mock setups) override locally in their own `.csproj` -- `Directory.Build.props` sets the default, individual projects may narrow or widen specific properties, same MSBuild property-overriding semantics as any other props file.

## `global.json`

```json
{
  "sdk": {
    "version": "8.0.100",
    "rollForward": "latestFeature"
  }
}
```

- `version` pins the minimum SDK feature band the solution builds against. Match this to the target framework chosen in `dotnet-solution-initializer` Round 2 (net8.0 -> an `8.0.1xx` SDK).
- `rollForward: latestFeature` allows patch/feature updates within the same major.minor SDK release (picks up bug fixes) without silently jumping to a new major version that might change compiler defaults.
- Commit `global.json` to the repo root (same directory as `Directory.Build.props`) so every clone and every CI runner resolves the same SDK, which is also what makes `@nx/dotnet`'s .NET SDK 8.0+ requirement (its `MsbuildAnalyzer` needs `Microsoft.Build.Locator`) enforceable in CI rather than "works on my machine."
