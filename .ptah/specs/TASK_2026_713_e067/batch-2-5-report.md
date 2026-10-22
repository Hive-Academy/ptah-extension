# Batches 2–5 authoring report

Grouped authoring of Tasks 2.1–2.3, 3.1, 4.1, and 5.1–5.3. Description bytes below are the unquoted `description` value, counted the same way as `skill-description-shape.spec.ts` (`unquote`, then length, then `"..."` phrase matches, then `\(\d+\)`). This lane did not run Jest, Nx, lint, tsc, or `manifest:check`. These lines are not evidence that a host loaded or invoked any skill. Class R was not run.

## Counts

| Skill | Chars | Double-quoted phrases | Numbered-list pattern | `ptah_*` tokens in the description |
| --- | ---: | ---: | --- | --- |
| `angular-frontend-patterns` | 399 | 0 | no | none |
| `angular-3d-scene-crafter` | 396 | 0 | no | none |
| `angular-gsap-animation-crafter` | 396 | 0 | no | none |
| `agent-lanes` | 376 | 0 | no | `ptah_agent_*`, `ptah_agent_spawn` (both already on the previous line; none added) |
| `ptah-cli-usage` | 295 | 0 | no | none |
| `ptah-surface-authoring` | 351 | 0 | no | none |
| `ddd-architecture` | 286 | 0 | no | none |
| `resilient-nestjs-patterns` | 375 | 0 | no | none |

Each description is one physical line. Every `name` still equals its directory.

## Files

- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-frontend-patterns/SKILL.md` — description only. Body unchanged.
- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-3d-scene-crafter/SKILL.md` — description only. Body lines that include motion and animation tuning were not edited.
- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-angular/skills/angular-gsap-animation-crafter/SKILL.md` — description only. Body unchanged.
- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/agent-lanes/SKILL.md` — description only. Body unchanged.
- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-cli-usage/SKILL.md` — description, plus the allowed selection relocation. Heading is now `## Which surface`. No heading normalises to "when to use this skill".
- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md` — description only. Body unchanged.
- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ddd-architecture/SKILL.md` — description only. Body unchanged.
- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/apps/ptah-extension-vscode/assets/plugins/ptah-nx-saas/skills/resilient-nestjs-patterns/SKILL.md` — description only. Body unchanged.
- `D:/projects/ptah-extension/.claude-worktrees/skill-routing/.ptah/specs/TASK_2026_713_e067/batch-2-5-report.md` — this file.

The twenty retained skills, Batch 1 files, specs, manifest, templates, runtime code, and `batches.md` were not edited.

## Task evidence

### 2.1 `angular-frontend-patterns`

WHAT stays Angular component and state patterns on signals. WHEN stays components, signal state, RxJS interop, routing, and forms. `angular-3d-scene-crafter` and `angular-gsap-animation-crafter` are named as compatible siblings for scene construction and scroll motion, not replacements for this component and state guidance. React component work is named as `composition-patterns` and `react-best-practices`. The line does not say animation is out of scope.

### 2.2 `angular-3d-scene-crafter`

Primary subject stays Angular 3D scenes, and the description includes in-scene motion and animation tuning. Scroll-timeline page motion names `angular-gsap-animation-crafter` and may load when the task has both. Component structure may load `angular-frontend-patterns`. Non-Angular 3D work is outside this skill. Animation is not treated as foreign.

### 2.3 `angular-gsap-animation-crafter`

Primary subject stays scroll, parallax, and timeline motion for `@hive-academy/angular-gsap`, including pinned or hijacked-scroll sections. A 3D scene names `angular-3d-scene-crafter` and may load when the task has both. Component structure may load `angular-frontend-patterns`. Non-Angular animation is outside this skill.

### 3.1 `ptah-cli-usage`

The description triggers on headless, CI, another process, or no clickable UI. It does not depend on the user naming a command. Selection sentences that began "Reach for it whenever" and "If a human needs to click" left the body. Next to the surface table, the body still says the process speaks JSON-RPC 2.0 NDJSON over stdio, has no clickable UI, and exits when stdin closes. That stdin sentence is contiguous in the body and is not only in the description. The NDJSON hard-rule heading, command table, install steps, and the other hard rules remain. The NDJSON hard rule was not copied into the surface section.

### 4.1 `agent-lanes`

WHAT still covers spawning, resuming, and messaging. WHEN now includes a task that spawns or resumes a lane even when it never names a tool, `orchestration`, or `tribunal`. The load-before-spawn case still names `ptah_agent_spawn`. The line says this skill is the mechanic those two load for lane work, not a substitute for the engineering workflow or a multi-vendor panel. It does not say either skill rejects a lane request. This revision is prominence and task framing. It is not a claim that the previous line was measured to fail routing.

### 5.1 `ptah-surface-authoring`

WHAT leads: authoring `ptah-ui` blocks the host renders from verified data. WHEN keeps turn summary, stats, file changes, test results, chart, usage, and plan limits in Ptah chat or the display panel. Marketing copy names `technical-content-writer`. A visual-system spec names `ui-ux-designer`. Both may still apply when the task also asks for copy or a design system.

### 5.2 `ddd-architecture`

WHEN keeps deciding whether DDD is warranted, bounded contexts, aggregates, entities and value objects, CQRS, and domain events. The only added boundary is that .NET project and solution layout is `dotnet-solution-architect`. There is no Nest module-wiring boundary. The line does not say this skill rejects .NET domain work.

### 5.3 `resilient-nestjs-patterns`

WHEN stays retries, fallbacks, EventEmitter or SSE, and `forRoot`/`forTesting` dynamic modules. Persistence, auth, RBAC, and repositories name `nestjs-backend-patterns`. Inbound webhook plumbing names `webhook-architecture`. A task that both persists and retries may load both. The description does not forbid the second skill.

## Decisions

1. **Shorten example lists so sibling sentences fit under 400 characters.** Options were dropping a required sibling name, or cutting secondary examples. Evidence: the shape spec caps the unquoted value at 400; the first full drafts were 446, 457, and 409 for the three Angular lines. Cut smart/dumb and component-communication wording from the frontend line, neon/space/glass/primitives and the Three.js parenthetical from the 3D line, and the GSAP/ScrollTrigger parenthetical from the motion line. Primary WHEN subjects from the plan stayed. Reversible by restoring examples if a later fix batch has room.

2. **Stop leading `resilient-nestjs-patterns` with service-splitting and controller/db layering.** Options were keeping that WHEN and only adding sibling names, or making resilience the WHEN. Evidence: the plan says that layering WHEN overlaps `nestjs-backend-patterns`, and the matrix treats a persistence-only task as that sibling's subject. The resilience WHEN (retries, fallbacks, events, dynamic modules) stayed. The body still teaches layering when this skill is loaded. Reversible.

3. **Keep both existing lane tool tokens and add none.** Options were replacing `ptah_agent_spawn` with "the host's lane-spawn tool", or keeping the tool-name case. Evidence: the line fits in 376 characters and zero double-quoted phrases with `ptah_agent_*` and `ptah_agent_spawn` still present. The host-tool paraphrase was unnecessary. Reversible.

4. **Retitle the CLI section `## Which surface` and leave operating facts beside the table.** Options were deleting the section, or moving only the selection sentences. Evidence: the approved plan withdrew deleting the section and names this title as the one that matches the table. Reversible.

## Risks

- Cap versus useful WHEN: handled by Decision 1. The verifier still owns the shape-spec command. This count is a local character measurement, not that spec.
- `agent-lanes` quote budget: zero double-quoted phrases. No new `ptah_*` token.
- Stdin lifetime: the exact words "exits when stdin closes" are in the body beside the surface table. An earlier wrap split them across two lines; that wrap was removed before this report.
- Composition: Angular, lane, surface, DDD, and Nest lines name siblings as loadable for the overlapping part of a task. They do not tell `orchestration` or `tribunal` to reject a lane task.
- Class R and Class S are not done here. Class L is not claimed.
- `ptah_agent_report` is not available in this session (`search_tool` returned no matching tool). The summary is in this file and in the lane's final message.

## Verifier handoff

After these eight edits, run the Batch 2 shape-spec command once:

`npx jest -c libs/backend/vscode-lm-tools/jest.config.ts libs/backend/vscode-lm-tools/src/lib/code-execution/skill-description-shape.spec.ts --coverage=false --maxWorkers=2`

Then the Class R matrix against all 28 current descriptions. Do not treat this report as that matrix, and do not start Batch 6 from this lane.
