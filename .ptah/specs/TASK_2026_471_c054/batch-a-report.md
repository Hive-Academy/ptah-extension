## What changed

`D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\prompt-suggestions.component.ts`

Replaced lines **180–335**: the preceding JSDoc and the hard-coded `readonly categories: PromptCategory[] = [...]` array. The component selector, inputs, `output()`, template, and `ChangeDetectionStrategy.OnPush` were left untouched.

## Card inventory

| Category | Title                       | Prompt                                                                                                                                        | Skill or command file it maps to                                            |
| -------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Build    | Orchestrate a feature       | `/orchestrate Build [describe your feature] with full workflow orchestration`                                                                 | `.claude/commands/orchestrate.md` / `.claude/skills/orchestration/SKILL.md` |
| Build    | Bootstrap SaaS workspace    | `/saas-workspace-initializer Initialize a new SaaS project with Nx, NestJS, and Angular`                                                      | `.claude/skills/saas-workspace-initializer/SKILL.md`                        |
| Build    | Design NestJS feature       | `/nestjs-backend-patterns Design a NestJS feature module for [domain] with provider pattern and Prisma`                                       | `.claude/skills/nestjs-backend-patterns/SKILL.md`                           |
| Build    | Add Angular component       | `/angular-frontend-patterns Add a new Angular component with signals, OnPush, and smart/dumb split`                                           | `.claude/skills/angular-frontend-patterns/SKILL.md`                         |
| Build    | Generate project harness    | `Open the Setup Wizard, scan this workspace, analyze the project, and generate a harness.`                                                    | `libs/frontend/setup-wizard/CLAUDE.md`                                      |
| Fix      | Fix a bug                   | `/orchestrate BUGFIX: Fix [describe the bug you're seeing]`                                                                                   | `.claude/commands/orchestrate.md`                                           |
| Fix      | Run fix fleet               | `/fleet-orchestration Run a multi-agent fix fleet on [task spec range]`                                                                       | `.claude/skills/fleet-orchestration/SKILL.md`                               |
| Fix      | Humanize messy library      | `/humanize-library Refactor [library path] into single-responsibility files with clear names and no duplication`                              | `.claude/skills/humanize-library/SKILL.md`                                  |
| Fix      | Extract UI feature          | `/extract-and-relocate-angular-component-feature Move [feature] from [source component] into a new self-contained component in [destination]` | `.claude/skills/extract-and-relocate-angular-component-feature/SKILL.md`    |
| Review   | Code quality review         | `/review-code`                                                                                                                                | `.claude/commands/review-code.md`                                           |
| Review   | Logic correctness review    | `/review-logic`                                                                                                                               | `.claude/commands/review-logic.md`                                          |
| Review   | Security vulnerability scan | `/review-security`                                                                                                                            | `.claude/commands/review-security.md`                                       |
| Review   | Code review tribunal        | `/tribunal Review [module] with a multi-vendor panel and synthesize a cited verdict`                                                          | `.claude/skills/tribunal/SKILL.md`                                          |
| Review   | Audit UX                    | `/impeccable Audit the UX of [page/component] for accessibility, visual hierarchy, and performance`                                           | `.claude/skills/impeccable/SKILL.md`                                        |
| Agents   | Spawn CLI agent lane        | `/agent-lanes Spawn a background CLI agent lane to implement [task]`                                                                          | `.claude/skills/agent-lanes/SKILL.md`                                       |
| Agents   | Run headless Ptah           | `/ptah-cli-usage Run a headless Ptah CLI session over JSON-RPC to [execute task/serve MCP]`                                                   | `.claude/skills/ptah-cli-usage/SKILL.md`                                    |
| Agents   | Start tribunal panel        | `/tribunal Start a tribunal panel for [topic] and render a cited verdict`                                                                     | `.claude/skills/tribunal/SKILL.md`                                          |
| Agents   | Deploy fix fleet            | `/fleet-orchestration Deploy a fix fleet across [task spec range] with judge and commit`                                                      | `.claude/skills/fleet-orchestration/SKILL.md`                               |
| Explore  | Analyze architecture        | `/orchestrate RESEARCH: Analyze the codebase architecture, map the dependency graph, and document key patterns and boundaries`                | `.claude/commands/orchestrate.md`                                           |
| Explore  | Index workspace             | `Use Workspace Indexing to scan this workspace and report symbols, dependencies, and code quality metrics.`                                   | `libs/frontend/workspace-indexing/CLAUDE.md`                                |
| Explore  | View task board             | `Show the .ptah/specs task board and report tasks grouped by status.`                                                                         | `libs/backend/task-specs/CLAUDE.md`                                         |
| Explore  | Browse marketplace          | `Open the Ptah Marketplace and list available plugins or skills for [category].`                                                              | `libs/backend/plugin-marketplace` / `libs/frontend/marketplace`             |
| Explore  | Search memory               | `Search the Memory Curator for prior decisions and context about [topic].`                                                                    | `libs/backend/memory-curator/CLAUDE.md`                                     |
| Creative | Design landing page         | `/ui-ux-designer Design a landing page for [product] with brand discovery and design tokens`                                                  | `.claude/skills/ui-ux-designer/SKILL.md`                                    |
| Creative | Add 3D scene                | `/angular-3d-scene-crafter Create a 3D hero scene with neon lights and floating geometric shapes`                                             | `.claude/skills/angular-3d-scene-crafter/SKILL.md`                          |
| Creative | Add scroll animation        | `/angular-gsap-animation-crafter Add scroll-triggered animations with parallax to [section]`                                                  | `.claude/skills/angular-gsap-animation-crafter/SKILL.md`                    |
| Creative | Write technical content     | `/technical-content-writer Write a technical blog post about [topic] grounded in our codebase`                                                | `.claude/skills/technical-content-writer/SKILL.md`                          |
| Creative | Record video showcase       | `/video-showcase Record a narrated marketing demo of [feature]`                                                                               | `.claude/skills/video-showcase/SKILL.md`                                    |

## Dropped

- **Simplify changed code** (stale card) — `/simplify` is not present in `.claude/skills/` or `.claude/commands/`.
- **Security tribunal** (proposed Review card) — dropped because `/review-security` is a shipped command (`.claude/commands/review-security.md`), so the Review category already has a direct security review slot. Keeping both would duplicate the same capability.
- **Review architecture** (proposed Review card) — dropped because the same `/orchestrate RESEARCH` prompt is represented in Explore as **Analyze architecture**, and the Review category needed room for the three shipped `/review-*` commands the specification incorrectly flagged as absent.

## Verification

### `npx nx run-many -t typecheck -p @ptah-extension/chat-ui`

```
 NX   Running target typecheck for project @ptah-extension/chat-ui:

- @ptah-extension/chat-ui


> nx run @ptah-extension/chat-ui:typecheck

> npx ngc --noEmit --project libs/frontend/chat-ui/tsconfig.lib.json



 NX   Successfully ran target typecheck for project @ptah-extension/chat-ui
```

### `npx nx run-many -t lint -p @ptah-extension/chat-ui`

```
 NX   Running target lint for project @ptah-extension/chat-ui:

- @ptah-extension/chat-ui


> nx run @ptah-extension/chat-ui:lint

Linting "@ptah-extension/chat-ui"...

D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-activity.component.ts
  818:1   warning  File has too many lines (836). Maximum allowed is 700  max-lines
  955:42  warning  Forbidden non-null assertion                           @typescript-eslint/no-non-null-assertion

D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-header.component.ts
  7:31  warning  'Zap' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\chat-ui\src\lib\molecules\session\session-stats-summary.component.ts
  828:1  warning  File has too many lines (729). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\mcp-directory-browser.component.ts
  818:1  warning  File has too many lines (867). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\plugin-browser-modal.component.ts
  973:1  warning  File has too many lines (856). Maximum allowed is 700  max-lines

✖ 6 problems (0 errors, 6 warnings)
✖ 6 problems (0 errors, 6 warnings)


 NX   Successfully ran target lint for project @ptah-extension/chat-ui


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

### `npx nx run-many -t test -p @ptah-extension/chat-ui`

```
 NX   Running target test for project @ptah-extension/chat-ui:

- @ptah-extension/chat-ui


> nx run @ptah-extension/chat-ui:test

Test Suites: 26 passed, 26 total
Tests:       186 passed, 186 total
Snapshots:   0 total
Time:        14.569 s
Ran all test suites.


 NX   Successfully ran target test for project @ptah-extension/chat-ui


Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```
