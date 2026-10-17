# Context - TASK_2026_689_4d4f

## User request (2026-10-17)

> also looking at this part i think using a canvas is not showing native 3d feeling and maybe is adding a
> bottleneck we don't need, i mean i think we can utilize something like these cool animations effects
> https://ngxui.com/docs along with angular capabilities somehow to build a more performant and pixel perfect
> designs replacing the canvas area with something like these attached screenshots

Reference image: `references/reference-exposure-command-center.webp` (a dark "Exposure Command Center"
dashboard: a glowing central core ring with a big metric, curved thin connectors from a labelled source list on
the left into the core, thick gradient ribbons from the core to status cards on the right, a faint dot grid, a
ticked outer dial ring, glass cards).

The user chose (AskUserQuestion, 2026-10-17): "Design now, in parallel" - start the design phase now in this
worktree while TASK_2026_687_615f (PR on `fix/command-center-open-issues`) continues.

## Orchestrator assessment (given to the user)

- SVG/DOM fits the reference better than canvas: crisp text, native focus and labels, no overlay plates or
  leader lines to mirror canvas positions (the source of most TASK_678/687 visual findings).
- About 24 nodes is not a canvas bottleneck; performance depends on animating only `transform`/`opacity`,
  static gradients, and no animated `filter`/`blur` on many paths.
- Separate task: it replaces `libs/frontend/command-center/src/lib/scene/*`, the overlay positioner and the
  label layout. It overlaps the deferred D58 artwork and D31 zoom/pan items (TASK_2026_678_9083).
- ngxui (https://ngxui.com/docs, "51+ open-source Angular components") could not be read (JS-rendered page);
  license, Angular 22 support and dependencies must be checked in the design phase.

## Workflow

Full orchestration: design spec + HTML prototype (dark + light) -> user approval -> implementation plan
(with preserve contract of the current scene: projection, selection, hover/pin, keyboard, work-list focus,
reduced motion, theme feeds, overflow) -> plan review -> codex lanes -> Anthropic review -> Electron visual check.
