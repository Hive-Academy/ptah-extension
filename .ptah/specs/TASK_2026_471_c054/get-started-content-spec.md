# Get Started prompt-suggestion refresh

## Where the content lives

`D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\setup-plugins\prompt-suggestions.component.ts`

Hard-coded array: lines 181–335 (`readonly categories: PromptCategory[] = [...]`).

## Stale cards

| Current card | Line | Why stale |
| --- | --- | --- |
| Create API endpoint | 194 | Generic `/orchestrate` prompt; not backed by a specific shipped skill or library. |
| Build a component | 199 | Generic `/orchestrate` prompt; does not invoke `angular-frontend-patterns` or any component-building skill. |
| Simplify changed code | 217 | Uses `/simplify`; no `simplify` skill exists in `.claude/skills/`. |
| Refactor module | 222 | Generic `/orchestrate REFACTORING` prompt; does not point to `humanize-library`, `extract-and-relocate-angular-component-feature`, or another refactor skill. |
| Code quality review | 235 | Uses `/review-code`; no `review-code` skill exists. Tribunal is the shipped multi-vendor review path. |
| Logic correctness review | 240 | Uses `/review-logic`; no `review-logic` skill exists. |
| Security vulnerability scan | 245 | Uses `/review-security`; no `review-security` skill exists. |
| Parallel codebase analysis | 258 | Talks about "CLI agents" but does not invoke `agent-lanes`, `fleet-orchestration`, or `tribunal`. |
| Generate tests with agents | 263 | Generic agent prompt; not backed by a specific skill or shipped test-generation library. |
| Multi-agent code review | 268 | Generic agent prompt; does not invoke `tribunal` or `fleet-orchestration`. |
| Delegate documentation | 273 | Generic agent prompt; does not invoke `technical-content-writer`. |
| Health check | 286 | Generic prompt; not backed by a specific skill or shipped diagnostic library. |
| Find what changed | 296 | Generic prompt; does not invoke `workspace-indexing` or any exploration skill. |
| Explain how it works | 301 | Mentions AST analysis but does not invoke a real skill; `workspace-intelligence` is the shipped analyzer. |
| Design a landing page | 314 | Uses `/orchestrate CREATIVE` instead of the shipped `ui-ux-designer` or `impeccable` skill. |
| Add 3D hero scene | 319 | References `@hive-academy/angular-3d`; shipped skill is `angular-3d-scene-crafter`. |
| Add scroll animations | 324 | Mentions GSAP but does not invoke the shipped `angular-gsap-animation-crafter` skill. |
| Write technical content | 329 | Uses `/orchestrate CREATIVE` instead of the shipped `technical-content-writer` skill. |

## Proposed cards

### Build

| Title | Subtitle | Prompt text | Backed by |
| --- | --- | --- | --- |
| Orchestrate a feature | Plan, implement, review | `/orchestrate Build [describe your feature] with full workflow orchestration` | `orchestration/SKILL.md` |
| Bootstrap SaaS workspace | Nx + NestJS + Angular | `/saas-workspace-initializer Initialize a new SaaS project with Nx, NestJS, and Angular` | `saas-workspace-initializer/SKILL.md` |
| Design NestJS feature | Controller-service-Prisma | `/nestjs-backend-patterns Design a NestJS feature module for [domain] with provider pattern and Prisma` | `nestjs-backend-patterns/SKILL.md` |
| Add Angular component | Signals, OnPush, split | `/angular-frontend-patterns Add a new Angular component with signals, OnPush, and smart/dumb split` | `angular-frontend-patterns/SKILL.md` |
| Generate project harness | Setup wizard scan | `Open the Setup Wizard, scan this workspace, analyze the project, and generate a harness.` | `libs/frontend/setup-wizard/CLAUDE.md` |

### Fix

| Title | Subtitle | Prompt text | Backed by |
| --- | --- | --- | --- |
| Fix a bug | Diagnose, fix, verify | `/orchestrate BUGFIX: Fix [describe the bug you're seeing]` | `orchestration/SKILL.md` |
| Run fix fleet | Multi-agent bugfix batch | `/fleet-orchestration Run a multi-agent fix fleet on [task spec range]` | `fleet-orchestration/SKILL.md` |
| Humanize messy library | Refactor for readability | `/humanize-library Refactor [library path] into single-responsibility files with clear names and no duplication` | `humanize-library/SKILL.md` |
| Extract UI feature | Move feature to component | `/extract-and-relocate-angular-component-feature Move [feature] from [source component] into a new self-contained component in [destination]` | `extract-and-relocate-angular-component-feature/SKILL.md` |

### Review

| Title | Subtitle | Prompt text | Backed by |
| --- | --- | --- | --- |
| Code review tribunal | Multi-vendor cited verdict | `/tribunal Review [module] with a multi-vendor panel and synthesize a cited verdict` | `tribunal/SKILL.md` |
| Security tribunal | Cross-vendor security audit | `/tribunal Run a security audit of [module] with a multi-vendor panel` | `tribunal/SKILL.md` |
| Audit UX | Accessibility and hierarchy | `/impeccable Audit the UX of [page/component] for accessibility, visual hierarchy, and performance` | `impeccable/SKILL.md` |
| Review architecture | Map dependencies and patterns | `/orchestrate RESEARCH: Analyze the codebase architecture, map the dependency graph, and document key patterns and boundaries` | `orchestration/SKILL.md` |

### Agents

| Title | Subtitle | Prompt text | Backed by |
| --- | --- | --- | --- |
| Spawn CLI agent lane | Background implementation worker | `/agent-lanes Spawn a background CLI agent lane to implement [task]` | `agent-lanes/SKILL.md` |
| Run headless Ptah | JSON-RPC CI pipeline | `/ptah-cli-usage Run a headless Ptah CLI session over JSON-RPC to [execute task/serve MCP]` | `ptah-cli-usage/SKILL.md` |
| Start tribunal panel | Council, Forge, or Crucible | `/tribunal Start a tribunal panel for [topic] and render a cited verdict` | `tribunal/SKILL.md` |
| Deploy fix fleet | Parallel agent task swarm | `/fleet-orchestration Deploy a fix fleet across [task spec range] with judge and commit` | `fleet-orchestration/SKILL.md` |

### Explore

| Title | Subtitle | Prompt text | Backed by |
| --- | --- | --- | --- |
| Analyze architecture | Dependency graph deep dive | `/orchestrate RESEARCH: Analyze the codebase architecture, map the dependency graph, and document key patterns and boundaries` | `orchestration/SKILL.md` |
| Index workspace | Symbols and quality metrics | `Use Workspace Indexing to scan this workspace and report symbols, dependencies, and code quality metrics` | `libs/frontend/workspace-indexing` / `libs/backend/workspace-intelligence/CLAUDE.md` |
| View task board | `.ptah/specs` statuses | `Show the .ptah/specs task board and report tasks grouped by status` | `libs/backend/task-specs/CLAUDE.md` |
| Browse marketplace | Plugins and skills | `Open the Ptah Marketplace and list available plugins or skills for [category]` | `libs/backend/plugin-marketplace` / `libs/frontend/marketplace` |
| Search memory | Prior decisions | `Search the Memory Curator for prior decisions and context about [topic]` | `libs/backend/memory-curator/CLAUDE.md` |

### Creative

| Title | Subtitle | Prompt text | Backed by |
| --- | --- | --- | --- |
| Design landing page | Brand discovery and tokens | `/ui-ux-designer Design a landing page for [product] with brand discovery and design tokens` | `ui-ux-designer/SKILL.md` |
| Add 3D scene | Three.js Angular scene | `/angular-3d-scene-crafter Create a 3D hero scene with neon lights and floating geometric shapes` | `angular-3d-scene-crafter/SKILL.md` |
| Add scroll animation | GSAP ScrollTrigger effects | `/angular-gsap-animation-crafter Add scroll-triggered animations with parallax to [section]` | `angular-gsap-animation-crafter/SKILL.md` |
| Write technical content | Blog grounded in code | `/technical-content-writer Write a technical blog post about [topic] grounded in our codebase` | `technical-content-writer/SKILL.md` |
| Record video showcase | Narrated product demo | `/video-showcase Record a narrated marketing demo of [feature]` | `video-showcase/SKILL.md` |

## Notes

- The current component uses `/orchestrate`, `/simplify`, and `/review-*` prefixes that do not exist as skills. The replacement set uses only skill names that appear in `.claude/skills/*/SKILL.md` frontmatter (`name` field).
- The Setup Wizard and Harness Builder are shipped surfaces, but they are UI wizards rather than slash skills. Their prompt cards are worded as natural-language instructions rather than `/command` prompts.
- Some shipped skills are intentionally omitted from this panel (e.g., `caveman`, `simple-english`, `ffmpeg-video-analysis`, `remocn`) because they are either meta-communication modes, niche video/QC tools, or internal tooling not exposed to the average extension user.
- The existing categories are kept as-is; only the per-category card content changes.
