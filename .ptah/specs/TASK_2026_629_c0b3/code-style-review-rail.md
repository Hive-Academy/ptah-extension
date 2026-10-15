# Code Style Review (Rail board API) - TASK_2026_629_c0b3

Scope: commits 6bf6073bb (R0), e877d0c91 (R1), f0462a870 (R2), limited to the new public API of Components 7, 7a and 8. Plan: `implementation-plan-rail.md` (approved, not redesigned).

## Verdict

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVED WITH FIXES |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 5 |
| Minor | 6 |

The API shape is sound and matches the plan. The numbered findings below are mostly about documentation and tooling hygiene. One real maintenance cost is the hand-written field list in `sameLaneSummary`.

## Boundary and convention checks (all confirmed by reading code)

| Check | Result | Evidence |
| --- | --- | --- |
| chat-ui does not import chat / chat-state / canvas | PASS | `compact-rail-card.component.ts:1-25` imports only `@angular/core` and sibling files. |
| Direction chat -> chat-ui, canvas -> chat-ui only | PASS | `compact-session-card.component.ts` imports the new symbols from the chat-ui barrel. `canvas-focus-area.component.ts:3`, `canvas-focus-header.component.ts:3` and `canvas-rail-board.component.ts:7` import `CompactRailState` with `import type`. |
| Canvas adds no public API | PASS | `git diff fe9ab1c91 HEAD -- libs/frontend/canvas/src/index.ts` is empty; `git log fe9ab1c91..HEAD` on the file is empty. |
| Standalone + OnPush | PASS | `compact-rail-card.component.ts:34-35` (`standalone: true` is redundant but matches the siblings). The smart card already has OnPush. |
| Signal inputs and outputs | PASS | All inputs use `input()` / `input.required()` and all outputs use `output()`: rail card `:129-151`, smart card `:172-179`. No decorators. |
| `import type` for type-only imports | PASS | `import type { DoCheck }` at `:14`. Inline `type` modifiers are used for mixed value/type imports (`:18-25`; smart card imports). This matches the existing smart-card style. |
| No new `any` / `as any` | PASS | None in the scoped files. |
| Barrel shape | PASS | `index.ts` adds the component after `CompactSessionStatsComponent`, the value constant on its own line, and the two types appended alphabetically inside the existing `export type {}` block. |
| Type precision | PASS | `Readonly<Record<CompactRailDensity, number>>` for the height map; `requestId` made required on the question and error callouts. Any producer that omits it fails the typecheck, which is the intent. |
| `terminalFailureSeq` shape | PASS | `chat-types.ts:786`, optional `number`, in the same optional-field style as `lastTerminalReason` and `lastTurnStateRevision`. |
| Tile branch unchanged | PASS | The tile branch in the smart-card template is untouched: `(answer)="openFullView()"` at `:147` and the other tile bindings are as before. |

## Findings

### 1. Moderate - Three touched files are no longer Prettier-clean (new regression)

- Files: `compact-rail-card.component.ts` (whole file, for example `:27-30`, `:36-66`, the long template lines at `:89-112`), `compact-lane.types.ts:9,66-71`, `compact-session-card.component.ts:78-90` and `:128-153`.
- `npx prettier --check` fails on all three. The pre-image of `compact-lane.types.ts` and `compact-session-card.component.ts` (from `e877d0c91^` and `f0462a870^`) passes, so the commits introduced the drift. The new rail card is entirely unformatted: single-line object literals, 200-character template lines and inline CSS packed onto one line.
- The `@else {` branch at `compact-session-card.component.ts:128` leaves the tile markup un-indented (the tile branch was kept byte-identical on purpose, per the plan).
- Impact: formatter noise lands in whichever later commit touches these files. This part of the repo is formatted, so the lanes bypassed or missed the formatter.
- Fix: run `npx prettier --write` on those 3 files. The tile-branch indent is the only part that touches existing lines, and that is acceptable.

### 2. Moderate - The new public surface is undocumented, unlike its neighbours

- Files:
  - `compact-rail-card.component.ts:32` has no class doc. Every sibling has one ("Fixed-height attention slot...", "Bounded, dual-pane wire console body..."). The 15 inputs and 8 outputs have no comment about the contracts that matter: `holdText` latches title, now and metrics only, while the callout always renders current values; `innerTabbable` is the roving-tabindex switch; `answer` and `showOutput` emit a shown `requestId`, while `allow`, `deny` and `openRequest` emit the callout.
  - `compact-lane.types.ts:66-71`: `CompactRailState`, `CompactRailDensity` and `COMPACT_RAIL_CARD_HEIGHT` have no doc comment, although every other export in the file has one. The constant is the single source for three consumers (card host, rail list item, scroll anchor per plan Component 8) and should say so. The file header (`:1-5`, "Lane data for the compact session card") is now stale, because the file also holds rail view types.
  - `compact-session-card.component.ts:172-179`: `variant`, `density`, `focused`, `holdText`, `railState`, `staleAction` and `lanesRequested` have no doc. `staleAction` ("an action carried a request id that is no longer the shown one; nothing was posted") and `lanesRequested` (fires after `openFullView()`) are behavioural contracts that the Rail wrapper depends on.
  - `chat-types.ts:785`: the one-line doc omits that the field is persisted, which is what keeps a restored error's id stable (plan 7a). Neighbours use multi-line JSDoc that states the lifecycle.
- Impact: a wrapper author has to reverse-engineer the contract from the spec files.
- Fix: add short JSDoc to each item listed above.

### 3. Moderate - `ngDoCheck` focus rescue has no stated reason and relies on DOM class queries

- File: `compact-rail-card.component.ts:173-185`.
- The hook queries `.rc-callout` and `.rc-select` by CSS class names defined in the same file's template and styles, and calls `afterNextRender` from inside a lifecycle hook. There is precedent for `ngDoCheck` in `canvas-focus-header.component.ts:64`. That precedent differs in two ways: it has no `afterNextRender`, and it uses the typed `host.nativeElement`.
- There is also a redundant cast: `(this.host.nativeElement as HTMLElement)` at `:177` and `:180`, while `:176` uses it uncast. `ElementRef<HTMLElement>` already types it, and `split-handle.component.ts:80` uses the same `inject(ElementRef<HTMLElement>)` form without casts.
- Impact: a new team member will likely "modernize" this into an `effect`, which runs after the old callout DOM is gone and so cannot detect that focus was inside it. The only way to learn why `ngDoCheck` is needed is the plan.
- Fix: add a 2-3 line comment ("must run before the keyed `@for` rebuild removes the focused button; an effect would run too late"). Drop the casts. Optionally pull the two selectors into named constants.

### 4. Moderate - `sameLaneSummary` hard-codes the fields of two evolving types

- File: `compact-session-card.component.ts:78-90`.
- It lists the 5 `CompactLaneStatus` keys and the 6 `CompactLaneRow` fields by hand. The `counts` type is `Record<CompactLaneStatus, number>`, so a new status would silently not be compared. The plan's mitigation is a spec case, but that only covers row fields.
- Impact: a field added later gives stale lane data with no type error.
- Recommendation: iterate the keys of `counts` (or compare against a `Record<keyof CompactLaneRow, true>` list) so the compiler forces an update. Alternatively, move the comparator next to the type in `compact-lane.types.ts` so the two change together. Placement is chat vs chat-ui; the plan puts it in chat, so only the first suggestion is a low-risk change.

### 5. Moderate - Naming collision forces `railStateValue`

- Files: `compact-session-card.component.ts:177` (output `railState`) and `:415` (computed `railStateValue`).
- The output took the natural name, so the computed it emits got a suffix, and the template binds the odd name at `:114`. Both names use "state" for different things (`CompactRailState`, the `state` input, the `railState` output).
- Impact: it reads as a duplicate. A reader cannot tell which one is the source of truth without opening the file.
- Recommendation: name the computed for what it is (`railCardState`, or `cardState`), keeping the output name that the Rail wrapper and the plan already use.

## Minor

6. `compact-session-card.component.ts:449,480,493,506,520` repeat the "shown id is still current" guard in five methods, with two spellings (`callout()?.requestId !== x` and the `kind` check). A private `isShown(id)` would pin the semantics in one place. It is not required yet, but the next stale-guard site will be a sixth.
7. `compact-rail-card.component.ts:108` calls `lanes().rows.slice(0, 3)` in the template, which allocates on every pass. A `computed` (for example `visibleRows`) would match the `laneCounts`, `todoCount` and `gitCount` computeds already used.
8. `compact-rail-card.component.ts:73` binds `[style.background]="'var(--rail-state-ink)'"` to a constant string. A class in the component's styles (like `.rc-pill` at `:62`) would be simpler.
9. `compact-rail-card.component.ts:129` names an input `title`, which shadows the native `title` attribute on the host. It works because Angular binds inputs first, but `state` and `model` make the input list read like DOM properties. This is acceptable as planned; just note it for reviewers of the Rail wrapper.
10. `compact-rail-card.component.ts:135` passes `model` as a separate input while `summary().metrics.model` is already carried by `summary` (the smart card passes `summary().metrics.model` at `:112`). The tokens and cost are read from `summary` in `metricsText()`, so the data source is inconsistent. The plan lists `model` explicitly, so this is only a note on maintenance.
11. `compact-rail-card.component.ts:51-52` bakes the zone heights as literals (`26px 16px 20px 70px 22px`, dense `26px 20px 22px 18px`) in the component's CSS while `COMPACT_RAIL_CARD_HEIGHT` (176 / 96) is in `compact-lane.types.ts`. They do not sum to the host height (154 + 8 padding vs 176; 86 + 8 vs 96). Whether that slack is intentional is a visual question for the visual reviewer; a comment saying so would stop a later change from "fixing" it.

## File-by-file

- `chat-types.ts` - 9/10. A minimal, correctly typed optional field in the established style (`:786`). The only gap is the doc detail in finding 2.
- `chat-ui/src/index.ts` - 10/10. Fits the existing barrel structure, with value and type exports separated as before.
- `compact-lane.types.ts` - 7/10. The types are right and the required `requestId` is the correct breaking change. It lacks doc comments, has a stale header comment, and fails Prettier (findings 1 and 2).
- `compact-rail-card.component.ts` - 6/10. Presentational and dependency-free as required, with signals throughout. It is undocumented, unformatted, and has an unexplained `ngDoCheck` (findings 1-3, 7, 8).
- `compact-session-card.component.ts` (new API only) - 7/10. The inputs, outputs and stale-guard design match the plan, and the tile path is untouched. It has an awkward computed name, a hand-rolled equality function and repeated guards (findings 4-6).

## Maintenance debt

- Introduced: 3 public types plus one constant in chat-ui; a 15-input / 8-output component; 4 inputs and 3 outputs on the smart card; a hand-maintained equality function.
- Retired: nothing (additive by design).
- Net: increases. It is justified by the plan, and the cost is contained as long as findings 2 and 4 are addressed.

## Review disposition

Fix findings 1-5 before the Rail wrapper batches build on this API. The Minor items are optional. Nothing here blocks the next batch.
