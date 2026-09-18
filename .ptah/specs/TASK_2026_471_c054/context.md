# Context

## Origin

The user opened the Tasks page, pressed **Registry**, and got the banner
`Failed to generate registry.` In the same message they asked two further
questions:

1. Can a task be assigned to an agent directly from the task list, the way the
   **Get Started** panel launches a prompt?
2. The Get Started panel is stale and must match the skills and the advanced
   setup the product ships today.

## Item 1 — registry error (already fixed, carried on this branch)

Root cause, confirmed against the production log
(`Ptah Electron-2026-09-18.log:1104`):

```
TypeError: Cannot read properties of undefined (reading 'scan')
    at sp.generate (app.asar/main.mjs:3491:27204)
```

`RegistryGeneratorService` decorated its first two constructor parameters with
`@inject(...)` and left the third undecorated. esbuild does not implement
`emitDecoratorMetadata`, so the bundled Electron and VS Code hosts carry no
`design:paramtypes` and tsyringe built the service with `scanner === undefined`.
Jest passed throughout because ts-jest does emit that metadata.

`TaskDoctorService.writer` had the identical latent defect and would have
crashed "Tidy finished" the same way. Both are fixed on this branch, plus a
regression test that asserts the token metadata rather than container
resolution — a resolution test cannot catch this class of defect.

**Open risk, out of scope here**: the defect class is repository-wide. Any
`@injectable` class with a mixed decorated/undecorated constructor is broken in
the bundles and green under Jest. Only `task-specs` was swept.

## Item 2 — assign a task to an agent from the board

`TaskStartService` already exists. A Start button on each card and row sends
`/orchestrate <taskId>` into a new chat tab and sets the task to `in_progress`.
A "Start isolated" variant appends a worktree directive.

What is missing is the **choice of agent**. See `implementation-plan.md` for
the full design. No new RPC method and no new namespace prefix are needed: the
roster comes from `autocomplete:agents` and `agent:detectClis`, both of which
already exist.

## Item 3 — Get Started card refresh

See `get-started-content-spec.md` for the proposed replacement cards.

**Correction to that spec, verified by the orchestrator**: it reports
`/review-code`, `/review-logic`, `/review-security` and `/orchestrate` as
non-existent. It looked only in `.claude/skills/`. All four exist in
`.claude/commands/`. Discard those four rows of its "Stale cards" table. Only
`/simplify` is genuinely absent from this workspace.

The real gap stands. Twenty-seven skills ship and the panel names almost none
of them: `tribunal`, `agent-lanes`, `fleet-orchestration`, `impeccable`,
`humanize-library`, `ui-ux-designer`, `angular-3d-scene-crafter`,
`angular-gsap-animation-crafter` and `video-showcase` all go unmentioned.

## Where the work happens

Worktree `D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents`,
branch `feat/tasks-page-agent-assign`, cut from `main` at `cbba134b3`.

This folder was first created in the main checkout by mistake, on the false
belief that `.ptah/**` is gitignored. `.gitignore:131-135` ignores `.ptah/**`
and then explicitly un-ignores `.ptah/specs/` — task specs are TRACKED history
and belong on the branch beside the code they describe. Moved here and
committed with the work.
