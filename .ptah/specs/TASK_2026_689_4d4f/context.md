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

## Design gate (2026-10-17)

The user chose "Approve with fixes" (AskUserQuestion) after design review round 2 (8/10, revise cap
reached). The implementation plan must close: N2 (hover preview grows the page; reserve space only
for a pinned plate and release it on close, Escape, outside click and selection change), M-R4
(ribbons under cards in compact and stacked layouts) and M-R5 (plate far from its row at 1440).
The proposed removal of the `canvasUnavailable` output and fallback is approved.

## Plan removals gate (2026-10-17)

After plan review round 2 the user decided (AskUserQuestion):

- Provider palette: approve the tokenized provider monogram + provider text.
- Failed/awaiting glyph: "can't we use icons better for that?" - use `lucide-angular` icons
  (already a workspace dependency) in the state color plus the visible state word: completed
  `CircleCheck`, failed `CircleX`, cancelled `Ban`, awaiting input `MessageCircleQuestion`,
  running/starting `LoaderCircle`, queued/idle/unknown `CircleDashed`.
- Anchoring APIs (`setCardAnchor`, `setOverlayLabels`, `getOverlayLabels`, `getCardAnchor`):
  approve removal.
- ngxui: the user confirmed "Local SVG/CSS" - no `@omnedia/ngx-*` package and no ported source;
  build the beam, border glow and core effects in the lib with SVG/CSS.

## Follow-up task (user, 2026-10-17) - start after 689 merges its PR

New task, own worktree and PR:
- Command Center initial state: show it first, then let the user start a new session or load a
  previous one. Today `CommandCenterSessionCoordinator.openOrResume()`
  (`model/session-coordinator.ts:55-145`) picks the active tab, else the last session, else a
  new tab, with no picker; only a "New session" button exists.
- Voice reply rule: the persona (`chat-state/src/lib/command-center-persona.ts:30`) has no rule
  for spoken replies; `toSpokenText()` (`voice/spoken-text.ts`) speaks the first 4 sentences /
  600 chars of the last assistant message. Add a rule: start each reply with 1-2 plain spoken
  sentences that give the answer, details after.

PR #747 (TASK_2026_687_615f): CI on `bb5f877b1` passed; all 4 CodeRabbit threads resolved.

## Outcome (user, 2026-10-17): reverted, not merged

After seeing the SVG/DOM scene in the running Electron app, the user said the previous canvas
view was much better: its radial layout and its motion/animation. Decision ("Revert + small PR"):
close PR #749 unmerged and keep the canvas scene on `main`. A new small PR from `main` keeps
only the transferable parts: provider marks (`ptah-provider-mark`) with the root-provider
fallback, Lucide state icons + state words in the DOM plate and work list, and the overlay fixes
from `code-logic-review.md` that also apply to the old overlay. The visual review was stopped
(not needed after the user's own verdict). This branch and worktree stay as a reference.
