# Batch 24 report

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.ts:236,493-506` — neutral missing-grade text and shared nullable grade display; agent outcome signals remain additional context.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-card.component.spec.ts:96-145,531-595` — three-kind states and updated agent expectations.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-detail-drawer.component.ts:164,603-615` — matching nullable grade and neutral style in drawer.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\clone-detail-drawer.component.spec.ts:264-296,310-394` — three-kind states and updated agent expectations.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\frontend\skill-synthesis-ui\src\lib\components\clones\skill-clones-view.component.spec.ts:435-454` — card-to-drawer parity through each Library tab.

`skill-clones-view.component.ts` required no edit: its existing card and drawer bindings at lines 312-337 and 353-377 already pass the same `CloneSummary`; the O14 save handler at lines 812-843 was untouched.

## Per-kind display

| Kind | State | Card | Drawer |
| --- | --- | --- | --- |
| Skill | 0 uses, null grade | “Never invoked yet…” sentence | Same sentence |
| Skill | 3 uses, null grade | Invocations 3; Success No grade | Same values |
| Skill | 3 uses, 0.75 grade / 0 grade | Invocations 3; Success 75% / 0% | Same values |
| Agent | 0 uses, null grade | “Never invoked yet…” sentence | Same sentence |
| Agent | 3 uses, null grade | Invocations 3; Success No grade | Same values |
| Agent | 3 uses, 0.75 grade / 0 grade | Invocations 3; Success 75% / 0% | Same values |
| Command | 0 uses, null grade | “Never invoked yet…” sentence | Same sentence |
| Command | 3 uses, null grade | Invocations 3; Success No grade | Same values |
| Command | 3 uses, 0.75 grade / 0 grade | Invocations 3; Success 75% / 0% | Same values |

## Preserve check

- Skills, Agents, Commands tabs and counts remain in the view. Card and drawer actions, body editing, history, revert, agent outcome context and scorecard remain.
- The existing scorecard badge remains visible for agents. “No grade” in the new metric uses `text-base-content-muted`, with no success or error color.

## UI flag handling

Batch 24 is UI-facing. Existing Electron Library visibility, VS Code notice, `skillsPaused` action gating, and agent-only scorecard loading remain unchanged. No new flag was needed.

## Verification

- Required nullable-path grep: `clone-card.component.ts:493,504` and `clone-detail-drawer.component.ts:603,613` handle `successRate !== null`, then use the batch-23 `formatSuccessRate` import at lines 51 and 64. `skill-clones-view.component.ts` has no formatter hit because it passes `CloneSummary` directly to both children.
- `ptah_get_diagnostics` returned zero errors in requested files. It reported 11 errors in sibling files outside Batch 24 ownership, including older candidate, suggestions, diagnostics and shared codec files.
- No tests, Nx, Jest, lint, build, or standalone typecheck command was run, per executor instruction. All edited files have LF line endings.

## Proposed Removals

None.

## Decisions

- **Use the shared task-folder grade for agents too.** Options: keep agent outcome signals as the sole rate, or show `CloneSummary.successRate` beside them. O15 requires the same grade rule for all three kinds; the preserve table requires outcome signals and scorecard to stay. Reversible.
- **Suppress an empty agent outcome metric only for the unused, ungraded state.** Options: keep “no data yet” in that state, or retain the established one-sentence empty state. O15 explicitly chooses the sentence. Outcome context remains when use or grade exists. Reversible.
- **Keep view production source unchanged.** Options: add a view formatter or use its existing same-object card/drawer bindings. Existing bindings already satisfy parity, and O14’s save handler must stay unchanged. Reversible.
