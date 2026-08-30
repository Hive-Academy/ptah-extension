---
name: dotnet-solution-initializer
description: Stage A bootstrap for .NET workspaces. Specializes the shared Stage A contract from saas-workspace-initializer (mandatory two-round AskUserQuestion discovery, roadmap to `.ptah/roadmap.md`, foundation-only scaffold, then stop) with .NET-specific Round 2 questions -- target framework, app shape, data access, auth, test framework, and whether the workspace should be Nx-managed. Names bounded contexts and solution layout via ddd-architecture and dotnet-solution-architect, then hands off `dotnet new` scaffolding to dotnet-template-engine's template-instantiation skill and test project wiring to dotnet-test. Use when starting a new .NET project, or adding .NET to an existing workspace, from the New Project flow. Do not use to implement features end-to-end in one session.
---

# .NET Solution Initializer

Two-stage bootstrap for .NET workspaces, specializing the same Stage A contract [`saas-workspace-initializer`](../saas-workspace-initializer/SKILL.md) uses for the Node/TypeScript stack: mandatory discovery, domain + layout design, a written roadmap, a foundation-only scaffold, then a hard stop. This skill owns discovery, domain modelling, solution/project layout, and the Nx decision. It never runs `dotnet new`, `dotnet test`, or any MSBuild/NuGet/EF command itself -- those are Microsoft's `dotnet/skills` plugins, invoked by name.

## Trigger Keywords

- "new .NET project", "start .NET", "create .NET solution", "bootstrap .NET"
- ".NET workspace", "ASP.NET Core project", "Blazor project"
- "initialize .NET workspace", "scaffold .NET solution"

## Division of labour

- **This skill owns**: discovery, bounded-context naming (via `ddd-architecture`), solution/project layout (via [`dotnet-solution-architect`](../dotnet-solution-architect/SKILL.md)), the `.ptah/roadmap.md` contract, and the Nx-or-not decision (via [`nx-dotnet-workspace`](../nx-dotnet-workspace/SKILL.md)).
- **Microsoft's `dotnet/skills` owns**: `dotnet new` execution (`dotnet-template-engine`, skill `template-instantiation`), test running (`dotnet-test`), EF Core/data (`dotnet-data`), MSBuild (`dotnet-msbuild`), NuGet (`dotnet-nuget`), ASP.NET Core (`dotnet-aspnetcore`), Blazor (`dotnet-blazor`). These install through the external-marketplace flow with explicit user consent -- `dotnet` and `dotnet-template-engine` are pre-selected for every `.NET` stack profile; the rest are offered, not forced.

Do not duplicate Microsoft's mechanics. When a step in this skill needs a command run, name the Microsoft skill that runs it and stop there.

## Contract

Same shape as `saas-workspace-initializer`'s Stage A:

```
a) Discovery        — mandatory two-round AskUserQuestion: business, then .NET stack
a2) Domain + layout design — ddd-architecture names bounded contexts/aggregates;
                     dotnet-solution-architect derives the solution/project layout
b) Roadmap          — write `.ptah/roadmap.md` (same schema as the SaaS initializer)
c) Foundation       — scaffold ONLY what Stage B depends on, handing execution off
                     to the Microsoft skills named above
d) Handoff          — emit "Foundation complete. Next tasks (run each in a new session): ..."
e) STOP             — do not implement domain features in this session
```

Stage B (every roadmap item beyond Foundation) runs later, one item per session, via `/orchestrate <slug>` or the project-manager agent -- identical to the SaaS flow.

## Step a) Discovery — mandatory, two-round `AskUserQuestion`

Discovery is not optional and answers are never assumed. Ask every choice question through the `AskUserQuestion` tool (2-4 options each) -- not as prose. If the `AskUserQuestion` tool is unavailable in this harness, ask the same question in plain text, listing the same options, and wait for the answer before proceeding -- the tool may degrade, the question may not. Never answer a discovery question on the user's behalf. Never proceed to Step a2 or scaffolding while a required question is unanswered.

If the seed prompt already contains an intake block (product, users, constraints, platform = `.NET`), read it first. Acknowledge what it already answers and skip those questions; still ask everything the intake block leaves open.

### Round 1 — Business (identical to the shared contract)

Ask exactly the five questions from [`saas-workspace-initializer` Step a, Round 1](../saas-workspace-initializer/SKILL.md#step-a-discovery--mandatory-two-round-askuserquestion): what is being built, who the customer is, core jobs-to-be-done/candidate domains, MVP scope, and monetization. Nothing about Round 1 changes for .NET -- the business questions are stack-agnostic by design, which is the whole point of stating them once in the shared contract instead of here.

Do not start Round 2 until every Round 1 question is answered.

### Round 2 — .NET Stack (ask after Round 1 is complete)

1. **Target framework** — net8.0 / net9.0 / net10.0 / Recommend for me
   - Recommend for me -> net8.0 (LTS, the floor `@nx/dotnet`'s MSBuild analyzer requires) unless the user's constraints call for a newer STS release.
2. **App shape** — Web API / Blazor / Minimal API + Worker / Class library / Recommend for me
   - Web API -> hands off to `dotnet-aspnetcore` in Stage B
   - Blazor -> hands off to `dotnet-blazor` in Stage B
   - Minimal API + Worker -> hands off to `dotnet-aspnetcore` for the API half, plain worker-service templates for the background half
   - Class library -> no web framework hand-off; the foundation is a library solution only
3. **Data access** — EF Core / Dapper / None (yet) / Recommend for me
   - EF Core -> hands off to `dotnet-data` in Stage B for `DbContext`, migrations, and provider wiring
   - Dapper -> no Microsoft skill owns this; `dotnet-solution-architect` places the query layer, Stage B implements it directly
   - None (yet) -> foundation ships no persistence library; Stage B adds one when a domain module needs it
4. **Auth shape** — Built-in JWT (ASP.NET Core Identity) / External provider (Entra ID, Auth0, Okta, etc.) / None yet / Recommend for me
5. **Test framework** — xUnit / MSTest / NUnit / Recommend for me
   - Recommend for me -> xUnit (the default `dotnet new` and `dotnet-test` both assume absent a stated preference)
   - Whichever is chosen, test project setup itself is `dotnet-test`'s job, not this skill's
6. **Nx-managed workspace?** — Yes / No / Recommend for me
   - Full decision logic, prerequisites, and caveats live in [`nx-dotnet-workspace`](../nx-dotnet-workspace/SKILL.md) -- invoke it now to get the recommendation and record the answer, don't re-derive the logic here.
   - Recommend for me -> the `nx-dotnet-workspace` default: Yes for multi-project or mixed .NET+frontend solutions, No for a single service. Never force either answer.

When the user picks "Recommend for me," give the one-sentence rationale from the table above before moving on. Discovery answers override every default in this skill.

## Step a2) Domain + Solution Layout Design

Run after discovery, before Step b (Roadmap) and before any scaffolding.

1. Invoke the `ddd-architecture` skill (ptah-core plugin) with the Round 1 answers -- jobs-to-be-done, candidate domains, MVP scope. It names the bounded contexts and aggregates exactly as it does for the Node/TypeScript path; nothing about bounded-context naming is .NET-specific.
2. Invoke [`dotnet-solution-architect`](../dotnet-solution-architect/SKILL.md) with the bounded contexts from step 1 and the Round 2 answers (app shape, data access, test framework). It decides Clean Architecture vs vertical slices, project naming, `ProjectReference` direction, Central Package Management, and test project placement.
3. Invoke [`nx-dotnet-workspace`](../nx-dotnet-workspace/SKILL.md) with the Round 2 Nx answer to get the concrete `nx add @nx/dotnet` steps (or confirmation that plain `dotnet new sln` is the right call) -- do this even when the answer was "No," so the roadmap can record why Nx was skipped.
4. All three outputs seed Step b's roadmap: bounded contexts become Phase 3 (Domain Modules) items; the solution/project layout becomes the Foundation phase's project list.

## Step b) Roadmap

Write `.ptah/roadmap.md` following [`saas-workspace-initializer`'s `references/roadmap-format.md`](../saas-workspace-initializer/references/roadmap-format.md) -- the schema is stack-agnostic (phases, slugs, charters, `Depends on:` lines) and is not duplicated here. Read it before writing.

.NET-specific notes for the Foundation phase:

- Every Foundation item this skill scaffolds is checked off `[x]`, exactly as in the shared schema.
- A typical .NET Foundation phase: `solution-init` (solution file + project skeletons via `dotnet-template-engine`), `cpm-baseline` (`Directory.Packages.props` + `Directory.Build.props` + `global.json` via `dotnet-solution-architect`), `test-baseline` (test project wiring via `dotnet-test`), and -- only when Round 2 chose Yes -- `nx-integration` (`nx add @nx/dotnet` via `nx-dotnet-workspace`).
- Domain Modules phase items map 1:1 to the bounded contexts from Step a2, same as the SaaS path.

## Step c) Foundation Scaffold

Scaffold ONLY what is load-bearing for Stage B. This skill designs the layout; it does not execute scaffolding commands itself.

### Always hand off

- **Solution + project skeletons**: invoke `dotnet-template-engine`'s `template-instantiation` skill with the project layout `dotnet-solution-architect` produced (project names, `dotnet new` templates, target framework). That skill already asks its own clarifying questions and runs `dotnet new --dry-run` before committing -- do not re-ask what it will ask.
- **Test project wiring**: invoke `dotnet-test` with the Round 2 test framework answer. If `dotnet-test` is not yet installed, say so and point at the external-marketplace install flow before proceeding -- it is not one of the plugins auto-required by the `.NET` stack profile.
- **CPM + build props + SDK pin**: apply `dotnet-solution-architect`'s `Directory.Packages.props`, `Directory.Build.props`, and `global.json` output directly (these are Ptah's own layout decisions, not Microsoft's execution mechanics).

### Include only when discovery makes them load-bearing

| Trigger from discovery                      | Add to foundation                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| App shape = Web API or Minimal API + Worker | Hand off to `dotnet-aspnetcore` for the API project skeleton                                                                       |
| App shape = Blazor                          | Hand off to `dotnet-blazor` for the Blazor project skeleton                                                                        |
| Data access = EF Core                       | Hand off to `dotnet-data` for the initial `DbContext` and migration baseline                                                       |
| Nx answer = Yes                             | Hand off to `nx-dotnet-workspace` for `nx add @nx/dotnet` and the inferred-target verification                                     |
| Auth = External provider                    | Foundation records the provider choice only; concrete wiring is a Stage B item, same rule as the SaaS path's external-auth trigger |

If a trigger does not fire, do NOT scaffold the corresponding piece. Stage B creates it later with full context.

### Verification before handoff

- `dotnet build` succeeds across the solution.
- If the Nx answer was Yes: `nx graph` renders and `nx run-many -t build,test` passes (remember `--no-restore` is the default -- run an explicit `dotnet restore` or `nx run-many -t restore` first on a clean checkout).
- `.ptah/roadmap.md` and `.ptah/scope-decisions.md` exist and are committed-ready.

## Step d) Handoff

Emit exactly this block, with the next phase's items expanded:

```
Foundation complete.

Roadmap written to .ptah/roadmap.md.
Scope decisions recorded in .ptah/scope-decisions.md.

Next tasks (run each in a NEW chat session, one at a time):

  /orchestrate <slug-1>   # <charter one-liner>
  /orchestrate <slug-2>   # <charter one-liner>
  ...

Each task will activate the relevant companion skill
(dotnet-solution-architect, and Microsoft's dotnet-aspnetcore /
dotnet-blazor / dotnet-data / dotnet-test as needed) and pick up
dependencies from the roadmap.
```

List only the next phase's items (typically Domain Modules). Do not list every roadmap item.

## Step e) STOP

After the handoff block, the session is done. Do not:

- Implement any bounded-context project, controller, or service beyond the foundation scope above.
- Pre-create empty stubs for future roadmap items.
- Re-enter discovery for items already on the roadmap.
- Run Microsoft's execution skills (`dotnet-test`, `dotnet-data`, `dotnet-aspnetcore`, `dotnet-blazor`, `dotnet-msbuild`, `dotnet-nuget`) yourself instead of handing off -- that duplicates work they already do correctly and drifts from their maintained behaviour.

If the user pushes for "just one more thing" in the same session, decline and point them at `/orchestrate <slug>` in a fresh chat.

## References

### Shared Stage A contract

- [saas-workspace-initializer](../saas-workspace-initializer/SKILL.md) -- the canonical Stage A contract (discovery protocol, roadmap format, stop-after-foundation rule) this skill specializes. Round 1 discovery questions and the roadmap schema are defined there, not duplicated here.
- [roadmap-format.md](../saas-workspace-initializer/references/roadmap-format.md) -- `.ptah/roadmap.md` schema, shared across every Stage A initializer.

### Companion skills (this plugin)

- [dotnet-solution-architect](../dotnet-solution-architect/SKILL.md) -- solution/project layout, Clean Architecture vs vertical slices, CPM, `ProjectReference` rules
- [nx-dotnet-workspace](../nx-dotnet-workspace/SKILL.md) -- the Nx-or-not decision and `@nx/dotnet` mechanics

### External skills

- `ddd-architecture` (ptah-core plugin) -- bounded contexts/aggregates in Step a2
- `orchestration` (ptah-core plugin) -- runs each Stage B roadmap item
- `dotnet-template-engine`, skill `template-instantiation` (dotnet/skills marketplace) -- `dotnet new` scaffolding
- `dotnet-test` (dotnet/skills marketplace) -- test project setup and running
- `dotnet-data` (dotnet/skills marketplace) -- EF Core and data access
- `dotnet-aspnetcore` (dotnet/skills marketplace) -- ASP.NET Core / Web API / minimal API
- `dotnet-blazor` (dotnet/skills marketplace) -- Blazor
- `dotnet-msbuild`, `dotnet-nuget` (dotnet/skills marketplace) -- build and package mechanics, invoked as needed
