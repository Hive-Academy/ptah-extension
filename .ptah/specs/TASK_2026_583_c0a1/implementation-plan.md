# Implementation Plan - TASK_2026_583_c0a1

All paths are relative to the worktree
`D:/projects/ptah-extension/.claude-worktrees/task-583-compact-polish`.

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_583_c0a1/task.md` (written from
  the orchestrator brief), `.ptah/specs/TASK_2026_531_compact/task.md`, and
  memory notes `canvas-view-mode-toggle` and `canvas-view-mode` (the header
  toggle is binary, and the menu stays enabled under lock).
- Corrections applied: the brief asks for height to be "persisted per tile in
  the layout intent". Source explicitly keeps height out of `TileIntent`
  (`canvas-layout-intent.ts:69-73`), and the canvas record uses a strict v2
  Zod schema (`canvas-layout-persistence.service.ts:28-41`). The height is
  therefore stored on the tab, next to `viewMode`. Decision D3 gives the
  reasoning. This meets the brief's actual goal of surviving a reload.
- Design handoff used: none. The visual reference is the normal view's
  `ToolCallHeaderComponent` (`libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts`).
- Missing decision-critical input: none.

Repository rules that apply (from the brief and the lint config):

- Standalone, OnPush, signal-based components.
- No `[innerHTML]`; markdown goes only through `MarkdownBlockComponent`
  (`libs/frontend/markdown/src/lib/markdown-block.component.ts:18-21`).
- No deep imports across libs, and `chat-ui` must not import `chat`.
- All touched libs are tagged `scope:webview` (`chat-ui/project.json:7`,
  `canvas/project.json:7`, `chat-state/project.json:7`).

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| The recap picks the newest `error` item before prose, searching across all turns | `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts:455-460` | **Root cause 1a.** Any tool failure beats later assistant prose. |
| A failed finalized tool's text is the raw `node.error` or `toolOutput` | `compact-session-summary.ts:280-287` | A PowerShell error body becomes recap content. |
| A live `tool_result` item's text is the raw `toText(event.output)`, for success too, with `contentKind` `result` or `error` | `compact-session-summary.ts:176-189` | **Root cause 2.** Feed rows show file contents or base64. The recap `result` fallback can also show tool output. |
| The recap renders `prose`, `result` and `error` alike through `MarkdownBlockComponent` | `compact-session-activity.component.ts:1015-1018`, template `:464-467` | **Root cause 1b.** Error text is parsed as markdown: indented lines become code blocks, `+`/`-` lines become lists, and `---` underlines become setext headings (the "large text"). |
| Markdown lists are wrapped in `.prose-list-card` bordered boxes | `libs/frontend/markdown/src/lib/marked-extensions.ts:309-312`, `apps/ptah-extension-webview/src/styles.css:1251-1258` | Nested lists become nested boxes. The recap overrides must flatten them. |
| Recap `pre` has `max-height: 120px; overflow: auto` inside a scrolling recap | `compact-session-activity.component.ts:321-329` and `:168-171` | **Root cause 1c.** Two scrollbars. |
| Status is "Failed" when any error item exists and no terminal reason is set | `compact-session-summary.ts:503-504` | The same error-first bias reaches the status and outcome tag. |
| A feed row's text is `detail || label`, and `detail` is `mark.text` after markdown stripping | `compact-session-activity.component.ts:752-769` | Rows show whatever `text` holds. The fix belongs in the summary builder. |
| The feed badge is a kind label (`TOOL`, `PROSE`...) coloured by kind | `compact-session-activity.component.ts:48-78`, `:638-643` | Tool rows need a tool-name badge instead. |
| The normal view: `ptah-tool-icon` plus a `badge badge-xs font-mono` with a status class (`badge-success`/`badge-info`/`badge-error`), a Ptah MCP short name, and a description from the input type guards with `.../a/b` path shortening | `tool-call-header.component.ts:72-86`, `:252-322`, `:391-413`, `:425-438` | The logic to reuse is private to a component. `permission-request-card.component.ts:352-377` has a second copy, and the compact builder (`compact-session-summary.ts:564-608`) is a third. Three uses justify extracting a pure util. |
| `ToolIconComponent` maps tool name to lucide icon and colour and is exported | `libs/frontend/chat-ui/src/lib/atoms/tool-icon.component.ts`, `chat-ui/src/index.ts:26` | Reuse through a same-lib relative import. |
| Tool-input guards come from `@ptah-extension/shared` | `tool-call-header.component.ts:20-30` | chat-ui already depends on shared. No new edge. |
| `ExecutionStatus` union | `libs/shared/src/lib/types/execution/node.ts:33-39` | Badge class mapping input. |
| The card body uses `container-type: size` with continuous `@container` rules (min-height 300/500, max-width 600) and a ResizeObserver-driven split | `compact-session-activity.component.ts:145-147`, `:250-289`, `:914-956` | **Verified:** the card adapts to any height. No card change is needed for R3. |
| `TabViewMode = 'full' \| 'compact' \| 'compact-tall'`; `isCompactViewMode` | `libs/frontend/chat-types/src/lib/chat-types.ts:444`, `:458-460` | Height is currently encoded as a mode. |
| `TabState.viewMode?` | `chat-types.ts:674` | View state lives on the tab. |
| Tab persistence is key-driven: every `TabState` key is written and compared except a fixed exclusion set | `libs/frontend/chat-state/src/lib/tab-persistence.ts:78-83`, `:105-118`, `:203-220` | A new optional `TabState` field persists and restores with no schema or version change (`:66-72` warns against bumping the version). |
| `sanitizeRestoredTab` is the single restore mapping for both readers | `tab-persistence.ts:152-190` | The legacy `compact-tall` migration belongs here. |
| `toggleTabViewMode` is binary; `setViewMode`, `getTabViewMode` | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2724-2745` | Keep the toggle. Add a height setter beside them. |
| The height tier is transient, derived from view mode, and never stored in intent | `libs/frontend/canvas/src/lib/canvas-layout-intent.ts:69-96` | The constraint shape changes from tier to units. |
| `heightUnitsFor`, `COMPACT_TALL_TILE_HEIGHT_UNITS` | `canvas-layout-intent.ts:18-25`, `:76-87` | To be replaced by a clamp. |
| Projection and the drag decoder read the tier (`isCompactViewMode(tier)`, `heightUnitsFor`) | `canvas-layout-intent.ts:428-448`, `:499-501`, `:620-622`, `:638`, `:742` | They must read `compact` and `heightUnits` from the constraint. |
| `cellHeightFor` treats `h === FULL_TILE_HEIGHT_UNITS` as a full tile for the 90% viewport floor | `libs/frontend/canvas/src/lib/canvas-layout.service.ts:125-131`, `:155-169` | Cap compact at `FULL - 1 = 5` so compact never triggers the full-tile floor. |
| The grid enables only `e, w` resize handles; compact tiles are `noResize`; the resize start rejects compact tiles | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:199-202`, `:319`, `:474-479`, `:807-816` | Reversed for compact: south handle only. |
| The resize commit reads only `w`, then snaps a span | `canvas-workspace-grid.component.ts:588-620` | Add a compact branch that reads `h`. |
| The lock uses `grid.setStatic(locked)`; a locked grid may still apply a changed view fingerprint | `canvas-workspace-grid.component.ts:379-394`, `:414-418` | Drag is impossible under lock. A fingerprint that includes units reflows menu-driven height changes under lock for free. |
| `viewConstraints` compares `(tabId, heightTier)` structurally | `canvas-workspace-grid.component.ts:218-238` | Extend the equality to units. |
| Existing CSS hides handles through `gridstack-item.ui-resizable-disabled > .ui-resizable-handle` | `canvas-workspace-grid.component.ts:162-167` | **Verified:** handles are direct children of the `gridstack-item` host, so CSS can gate them per direction. |
| Gridstack 12.6.0 creates handles with class `ui-resizable-${dir}` from the grid-level `resizable.handles` option | `node_modules/gridstack/dist/dd-resizable-handle.js:37-38,126`, `dd-gridstack.js:44` | Global `'e, s, w'` plus per-item CSS hiding. Widgets support `minH`/`maxH` (`types.d.ts:340-342`). |
| The tile menu's height group iterates `VIEW_MODE_OPTIONS` with `data-view-mode` and is enabled under lock | `libs/frontend/canvas/src/lib/canvas-tile.component.ts:66-82`, `:208-237`, `:552-556` | Replace with height presets plus a stepper. Keep the `data-view-mode` attribute on presets for the e2e selectors. |
| The e2e asserts that a compact tile has 2 hidden handles, and counts 3 `[data-view-mode]` items that stay enabled under lock | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:559-563`, `:670-686` | This spec must be updated. |
| No `webview-e2e-harness` scenario covers compact tiles or the canvas (only marketplace specs match "compact") | `libs/frontend/webview-e2e-harness/src/lib/scenarios/*` | Playwright coverage is the Electron e2e only. |

## Architecture decision

- **D1: recap selection.** A new rule in the summary builder decides what the
  recap shows, and each content item carries a `format`: `markdown`,
  `snippet` or `plain`. Only assistant prose and agent summaries use
  `markdown`. Tool errors use `snippet`, bounded and rendered as plain
  monospace text. This fixes the cause rather than hiding the output with
  CSS.
  - Rejected: rendering everything through markdown and adding more CSS.
    Setext headings, indented code and list parsing come from the markdown
    grammar itself, so CSS cannot undo them.
- **D2: feed tool rows.** Feed rows are built from the tool's input, never its
  output. `CompactSemanticMark` gains `toolName` and `excerpt`. The normal
  view's description logic is extracted into a pure util,
  `chat-ui/src/lib/utils/tool-target.utils.ts`, used by both
  `ToolCallHeaderComponent` and the compact builder. The feed renders
  `ptah-tool-icon`, a status-coloured tool-name badge, the target and a lucide
  status icon.
  - Rejected: embedding `ToolCallHeaderComponent` in each feed row. It needs a
    full `ExecutionNode`, renders a chevron and a `FilePathLinkComponent`
    click target, and is sized for the transcript. Live marks carry no node.
  - Rejected: a fourth copy of the path and description logic.
- **D3: height storage.** A new optional `TabState.compactHeightUnits` holds
  the height and persists through the existing key-driven tab persistence.
  `'compact-tall'` is removed from `TabViewMode` and migrated in
  `sanitizeRestoredTab`. Canvas clamps the value to `[2, 5]` when reading it.
  - Rejected: adding `heightUnits` to `TileIntent`. That needs canvas schema
    v3, because v2 is `strictObject` (`canvas-layout-persistence.service.ts:28-41`).
    Older clients would then refuse the record (`writable: false`, `:183-189`).
    Every intent mutator (reconcile, presets, drag) would have to carry the
    field, and it contradicts the documented invariant
    (`canvas-layout-intent.ts:69-71`). Height is already tab-owned (view mode),
    the header toggle and menu already mutate it under lock through
    `TabManagerService`, and the locked-grid view-fingerprint exception
    already reflows tab-owned changes.
  - Rejected: keeping `'compact-tall'` alongside a units field. That gives two
    sources of truth for one height.
- **D4: drag resize under lock is not allowed.** The lock calls
  `grid.setStatic(true)` (`canvas-workspace-grid.component.ts:414-418`), which
  removes all drag-and-drop and handles. Allowing one handle would fight
  Gridstack's static mode. The lock also means "no layout gestures" in the
  existing gesture guards (`:461-467`, `:531-534`). Height stays adjustable
  under lock through the menu presets and the new −/+ stepper. That is
  consistent with the memory note that the tile menu's height control works
  under lock, and the stepper is also the keyboard-accessible path that drag
  alone does not give.
- **D5: bounds.** Compact heights run from `MIN_COMPACT_TILE_HEIGHT_UNITS = 2`
  to `MAX_COMPACT_TILE_HEIGHT_UNITS = FULL_TILE_HEIGHT_UNITS - 1 = 5`. At 6 a
  compact tile would match full, and `cellHeightFor` would apply the full-tile
  viewport floor (`canvas-layout.service.ts:126-128`).
- **Assumptions:**
  - A1: `grid.load()` with existing ids applies `minH`/`maxH` to engine nodes,
    so the live drag stops at the bounds. Check: in a jest or e2e run, after
    `load`, `grid.engine.nodes[i].maxH === 5`. If it does not, the
    commit-time clamp is still the guarantee and the tile snaps back on
    reconcile.
  - A2: Gridstack fires `resizestart`/`resizestop`/`change` for a south
    handle exactly as for east/west. Check: the updated e2e drag test.
- **Effect on existing code:**
  - Replaced: the three-mode height menu, the `TileHeightTier` type and
    `heightUnitsFor`, the compact no-resize rule, and the error-first recap
    selection.
  - Unchanged: width intent, canvas persistence, drag intent decoding (apart
    from the height source), the binary header toggle, the compact card
    layout and its container queries, and `CompactSessionCardComponent`.

## Component specifications

### 1. Tool target util (chat-ui)

- Purpose: one pure definition of how a tool call is named and targeted in
  the UI.
- Responsibilities:
  - `describeToolTarget(toolName: string, toolInput: Readonly<Record<string, unknown>> | undefined): { readonly short: string; readonly full: string }`.
    `short` must match what `ToolCallHeaderComponent.getToolDescription()`
    returns today: shortened path `.../a/b`, Bash `description` or a
    40-character command, a 30-character Grep/Glob pattern, `__summary`,
    else the tool name. `full` must match `getFullDescription()`.
  - `displayToolName(toolName: string): string`. Returns the Ptah MCP short
    name (the logic of `getPtahToolName`) and otherwise the name unchanged.
  - `isPtahMcpToolName(toolName: string): boolean`.
  - `toolStatusBadgeClass(status: ExecutionStatus): string`. The mapping of
    `getBadgeClass`: complete -> `badge-success`, streaming -> `badge-info`,
    error -> `badge-error`, otherwise `badge-ghost`.
- Verified contracts: the guards `isReadToolInput`...`isGlobToolInput`
  (`tool-call-header.component.ts:20-30`) and `ExecutionStatus` (`node.ts:33`).
- Dependencies: `@ptah-extension/shared` only. It is pure, with no Angular.
- Integration points:
  - `ToolCallHeaderComponent`: its private `getToolDescription`,
    `getFullDescription`, `getPtahToolName`, `getBadgeClass`, `shortenPath`
    and `truncate` delegate to the util and are deleted. The template output
    must not change.
  - The compact summary builder (component 2).
- Failure behaviour: total. Unknown input shapes fall back to the tool name,
  and the functions never throw.
- Quality: must be behaviour-preserving for the header.
- Verification seam: new `tool-target.utils.spec.ts` with a table test for
  each tool family, Ptah MCP names in both conventions, missing input, and
  `__summary`.
- Files:
  - CREATE `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.ts`
  - CREATE `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.spec.ts`
  - MODIFY `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts`
- `permission-request-card.component.ts` stays as it is (out of scope).

### 2. Compact summary builder (chat-ui)

- Purpose: turn stream or tree state into recap content and feed marks, with
  the correct content selection.
- Contract changes in `compact-session-summary.ts`:
  - `CompactSemanticMark` gains two optional fields:
    - `readonly toolName?: string` — the raw tool name, on `tool` marks only.
    - `readonly excerpt?: string` — the bounded, path-redacted error excerpt,
      on failed tool marks only.
    - `text` keeps its meaning of "detail behind the label". For tool marks it
      is now the redacted target: `describeToolTarget(...).full` passed
      through `redactAbsolutePaths`, then the util's path shortening for
      display. It never holds tool output.
  - `CompactSummaryContent` gains
    `readonly format: 'markdown' | 'snippet' | 'plain'`:
    - `question`, `permission`, `idle` -> `plain`;
    - assistant prose (including prose re-toned by `markFailedTurn`) and
      agent summary text -> `markdown`;
    - a tool error -> `snippet`;
    - a tool target used as `result` -> `plain`;
    - the compaction summary -> `markdown`.
  - `SemanticItem` carries `format` and `excerpt` internally.
- Behaviour changes:
  - Live `tool_start` (`:164-175`): the label becomes `${name} started`; `text`
    is the target (no verb); `toolName` is set.
  - Live `tool_result` (`:176-189`): `text` is the target taken from the prior
    `tool_start`'s `toolInput` (`state.events.get(event.toolCallId)`, which is
    already read at `:177`). Output is never used on success. On failure,
    `excerpt` is the bounded excerpt of `toText(event.output)` and
    `contentKind` is `'error'`.
  - Finalized tool (`:268-289`): `text` is the target, success or failure.
    On failure, `excerpt` is the bounded excerpt of
    `node.error || toText(node.toolOutput)`.
  - Excerpt bound: first 8 lines, then 600 characters, then
    `redactAbsolutePaths`. The bound is applied before redaction so the regex
    runs on bounded input, in line with the ReDoS care at spec `:142`.
  - Delete `describeTool`, `toolVerb` and `safePathOrText` (`:564-608`).
    `redactAbsolutePaths` and `workspaceLabel` stay.
  - `selectContent` (`:429-478`) after the prompt branches: scan items from
    newest to oldest.
    - A `prose`-kind item wins, including prose re-toned as error by
      `markFailedTurn`: `kind: 'prose'` or `'error'`, format `markdown`.
    - A `terminal` error item wins: `kind: 'error'`, format `plain`.
    - A failed `tool` item wins only if no successful tool or agent item has
      been passed during the scan (the assistant has not moved on):
      `kind: 'error'`, `text = excerpt`, format `snippet`.
    - Successful tool or agent items set the "moved on" flag and are skipped.
    - If nothing matches: the newest `result` item (agent summary ->
      `markdown`, tool target -> `plain`), then the compaction summary, then
      idle.
  - `selectStatus` (`:503-504`): return `Failed` only when the selected
    content's kind is `error`. The content is passed in; it is no longer
    `findNewest(items, 'error')`.
- Dependencies: component 1 (a same-lib relative import from
  `../../utils/tool-target.utils`).
- Integration points: `CompactSessionCardComponent`
  (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:122-139`)
  calls `summarizeLive` and `summarizeFinalized` unchanged. No change there.
  `chat-ui/src/index.ts:61` already exports the types.
- Failure behaviour: `toText` keeps its serialization guard (`:631-643`).
  Missing input gives the tool name as the target.
- Security: every string that reaches a mark or the content still passes
  through `redactAbsolutePaths`. The "redacts Windows and POSIX absolute
  paths" spec must keep passing.
- Verification seam: `compact-session-summary.spec.ts`. The mandatory new or
  updated cases:
  - (a) finalized turn with a failed Bash (PowerShell text) followed by prose:
    the recap is the prose, format `markdown`, status not `Failed`;
  - (b) a live stream whose newest event is a failed tool: the recap is a
    snippet, at most 8 lines and 600 characters, redacted;
  - (c) a failed tool followed by a successful tool with no prose: the recap
    is not the error;
  - (d) a live successful `tool_result` whose output is file content: the
    mark's `text` is the target and contains none of the output;
  - (e) `toolName` is set on tool marks;
  - (f) update the existing "questions over permissions and errors" and
    "uses total tool fallbacks" expectations for the new label and text.
- Files: MODIFY
  `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts`
  and its `.spec.ts`.

### 3. Compact activity view (chat-ui)

- Purpose: render the recap and feed per the new contract.
- Responsibilities:
  - Recap:
    - `format === 'markdown'` -> the existing
      `<div class="cs-recap-md"><ptah-markdown-block>`.
    - `format === 'snippet'` -> a `<pre class="cs-recap-snippet ...">` with
      interpolated text: mono, `text-[11px]`, `whitespace-pre-wrap`,
      `overflow-wrap: anywhere`, `text-error`, no own max-height or overflow.
    - `format === 'plain'` -> the existing `<p>`.
    - Replace `isMarkdownContent()` (`:1015-1018`) with a read of `format`.
  - Recap CSS (`:291-369`), so the recap has one scroll area and no nested
    boxes:
    - `.cs-recap-md pre`: drop `max-height` and `overflow: auto`; set
      `white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible`.
    - Add `.cs-recap-md .prose-list-card`: `background: none; border: 0;
      padding: 0; margin: 0.25rem 0; font-size: inherit`.
    - Headings: add `border: 0; padding-bottom: 0`, keeping the 0.8125rem
      size.
    - `.cs-recap-md table`: keep `display: block; overflow-x: auto`. It is the
      only allowed inner horizontal scroll, and it is for real tables only.
  - Feed rows (`:605-662`), for `mark.kind === 'tool' && mark.toolName`:
    - `<ptah-tool-icon [toolName]="mark.toolName">`;
    - a `badge badge-xs font-mono px-1.5` with
      `toolStatusBadgeClass(statusFor(mark.tone))` (live -> streaming,
      success -> complete, error -> error) and text
      `displayToolName(mark.toolName)`;
    - the target `row.text`;
    - a trailing lucide `CheckCircle` (`text-success`) or `XCircle`
      (`text-error`) for settled rows;
    - live rows keep the existing single blinking cursor on the newest live
      row only (`newestLiveMarkId`, `:811-817`). No per-row spinner, per the
      rule for unbounded lists.
    - Other kinds keep the kind badge (`KIND_LABEL`, `KIND_BADGE_TONE`).
  - `CompactFeedRow`: `detail` for tool marks is `excerpt` when failed, else
    the full target when it differs from the truncated row text, else `null`.
    It is never output. `title` is `${label} — ${text}`.
- Imports: add `ToolIconComponent` (relative `../../atoms/tool-icon.component`),
  `LucideAngularModule`, `CheckCircle` and `XCircle` from `lucide-angular` (as
  in `tool-call-header.component.ts:8-15`), and the util functions.
- Failure behaviour: a tool mark without `toolName` (not expected) falls back
  to the kind badge.
- Quality: every row stays a single line, and no row gains a timer or
  observer.
- Accessibility: the tool badge text is the name, and status is dual-coded
  (icon plus badge colour plus label in `title`). Decorative icons carry
  `aria-hidden`.
- Verification seam: `compact-session-activity.component.spec.ts`.
  - Update the cases at `:136`, `:175`, `:231`, `:268`, `:523`.
  - New cases:
    - a tool row renders `ptah-tool-icon`, a badge with the tool name and the
      status class, and a check icon;
    - a failed tool row expands to the excerpt;
    - `format: 'snippet'` renders a `<pre>` and no `ptah-markdown-block`;
    - `format: 'markdown'` renders `ptah-markdown-block`;
    - no feed row text contains a success output fixture.
- Files: MODIFY
  `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts`
  and its `.spec.ts`.
  `compact-wire-text.ts` and `compact-plain-text.ts` are unchanged; they are
  still used for labels and titles.

### 4. Tab view state (chat-types plus chat-state)

- Purpose: own the compact height as tab state, next to `viewMode`.
- Contract (`chat-types.ts`):
  - `TabViewMode = 'full' | 'compact'`. Rewrite the doc at `:427-443`: height
    is now `compactHeightUnits`.
  - `isCompactViewMode(mode)` is kept with the same signature and becomes
    `mode === 'compact'`. It has five consumers, so keeping the name avoids
    churn.
  - `TabState.compactHeightUnits?: number`: "Compact tile height in canvas
    grid rows. Opaque to chat; canvas clamps it on read. Absent means the
    canvas default."
- Contract (`tab-manager.service.ts`, beside `:2724-2745`):
  - `setCompactHeight(tabId: string, units: number): void`. It ignores
    non-integer or non-positive `units`, then calls
    `updateTabInternal(tabId, { viewMode: 'compact', compactHeightUnits: units })`.
    It is a no-op when both are already equal.
  - `getTabCompactHeightUnits(tabId: string): number | undefined`.
  - `toggleTabViewMode` stays binary and unchanged (memory note
    `canvas-view-mode-toggle`). Re-entering compact reuses the stored
    `compactHeightUnits`.
  - Update the doc comment at `:2711-2723` to stop mentioning `compact-tall`.
- Migration (`tab-persistence.ts` `sanitizeRestoredTab`, `:169-190`):
  - If `(tab.viewMode as string) === 'compact-tall'`, set
    `viewMode: 'compact'` and `compactHeightUnits: tab.compactHeightUnits ?? 3`,
    using a named constant `LEGACY_COMPACT_TALL_HEIGHT_UNITS = 3`.
  - Drop a `compactHeightUnits` that is not a positive integer.
  - This is the single restore path for both readers (`:152-168`). No version
    bump, per `:66-72`.
- Failure behaviour: an invalid persisted value is dropped and canvas falls
  back to 2. Invalid setter input is ignored.
- Verification seam:
  - `tab-restore-sanitize.spec.ts`: `compact-tall` maps to compact 3; an
    explicit value is kept; a garbage value is dropped.
  - `tab-manager.intent-mutators.spec.ts` and `tab-manager.service.spec.ts`:
    replace `compact-tall` cases with `setCompactHeight` cases (sets compact
    and units; a no-op on an equal value; ignores 0, -1 and 2.5; toggle
    returns to full and back to compact with the stored units).
  - `tab-manager.persistence.spec.ts`: `compactHeightUnits` round-trips.
- Files: MODIFY
  - `libs/frontend/chat-types/src/lib/chat-types.ts`
  - `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
  - `libs/frontend/chat-state/src/lib/tab-persistence.ts`
  - The specs listed above.
  - The doc comment in `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:711`
    and the `compact-tall` cases in `chat-view.component.spec.ts`.

### 5. Canvas height projection (canvas-layout-intent)

- Purpose: project geometry from per-tile height units.
- Contract changes:
  - Remove `COMPACT_TALL_TILE_HEIGHT_UNITS`, `TileHeightTier` and
    `heightUnitsFor`.
  - Rename `COMPACT_TILE_HEIGHT_UNITS` to `MIN_COMPACT_TILE_HEIGHT_UNITS = 2`
    and add `MAX_COMPACT_TILE_HEIGHT_UNITS = FULL_TILE_HEIGHT_UNITS - 1`.
  - `clampCompactHeightUnits(value: number | undefined): number`: non-finite
    or undefined gives MIN; otherwise `Math.round`, then clamp.
  - `TileViewConstraint = { readonly tabId: string; readonly compact: boolean; readonly heightUnits: number }`.
  - `viewConstraintsFingerprint` encodes `${len}:${id}=${compact ? 'c' : 'f'}${heightUnits}`.
  - `resolvePreferredWidths` and `finishPreferredRow` take a
    `ReadonlySet<string>` of compact ids in place of the tier map
    (`:377-449`).
  - `projectTileGeometry` reads `compact` and `heightUnits` from the
    constraint (absent means full, `FULL_TILE_HEIGHT_UNITS`) (`:469-501`).
  - `projectDragIntent` gets `expectedHeightOf` from the constraint's
    `heightUnits` (`:620-622`), and its transient-x check uses `compact`
    (`:739-742`).
  - Remove the `isCompactViewMode` import (`:1`); canvas no longer needs
    chat-types here.
- Failure behaviour: total functions, unchanged.
- Verification seam: `canvas-layout-intent.spec.ts`.
  - Replace tier fixtures with units fixtures.
  - New cases:
    - compact at 4 and 5 units packs with the skyline, and a later tile fills
      below it;
    - the drag decoder accepts `h === heightUnits` and rejects the old tier
      height;
    - the fingerprint changes when only units change;
    - the clamp bounds.
- Files: MODIFY `libs/frontend/canvas/src/lib/canvas-layout-intent.ts` and
  its `.spec.ts`. MODIFY `canvas-layout.service.ts` only for the doc comment
  at `:92`; its logic is unchanged (the `hasFullTile` rule holds because the
  compact maximum is 5).

### 6. Canvas grid resize (canvas-workspace-grid)

- Purpose: offer and commit south-edge height resize for compact tiles.
- Responsibilities:
  - `viewConstraints` (`:218-238`): build
    `{ tabId, compact, heightUnits }`, where
    `compact = isCompactViewMode(tab.viewMode)` and
    `heightUnits = compact ? clampCompactHeightUnits(tab.compactHeightUnits) : FULL_TILE_HEIGHT_UNITS`.
    The equality compares all three fields.
  - `compactTabIds` (`:245-252`) and `isCompactSingleton` (`:255-262`) read
    `constraint.compact`.
  - `gsOptions.resizable.handles`: `'e, s, w'`. Update the comment at
    `:199-201`.
  - The template binds `[class.ptah-compact-item]="item.compact"` on
    `<gridstack-item>`, and `items()` exposes `compact`.
  - New styles:
    - `gridstack-item.ptah-compact-item > .ui-resizable-e` and
      `> .ui-resizable-w`: `display: none !important`;
    - `gridstack-item:not(.ptah-compact-item) > .ui-resizable-s`:
      `display: none !important`.
  - `items()` (`:319`): `noResize = frozen` (compact no longer excluded).
  - `applyNodeInteractionState` (`:807-816`): `resizable = interactive`.
  - `onGestureStart` (`:474-479`): remove the compact-resize rejection.
  - `applyAuthoritativeGeometry` `grid.load` entries (`:760-769`): compact
    tiles add `minH: MIN_COMPACT_TILE_HEIGHT_UNITS` and
    `maxH: MAX_COMPACT_TILE_HEIGHT_UNITS` (Assumption A1).
  - `onGridChange` resize branch (`:588-620`):
    - If the dragged id is compact: read the engine node's `h`. If it is a
      finite integer, `units = clampCompactHeightUnits(h)`, then
      `tabManager.setCompactHeight(draggedId, units)` when `units` differs
      from the current value. Count it as accepted, then
      `reconcileGesture(gesture)`. Width is ignored because it is derived.
    - Otherwise: the existing span path, unchanged.
  - Lock stays as it is: `setStatic(true)` shows no handles, and the gesture
    guards refuse. Menu-driven height changes under lock reflow through the
    existing view-fingerprint exception (`:384-389`), because the fingerprint
    now includes units.
- Dependencies: `TabManagerService` from `@ptah-extension/chat` (already
  injected at `:184`) and `isCompactViewMode` (already imported at `:36`).
- Failure behaviour: a non-integer or missing `h` counts as a rejected
  gesture and reconciles to authoritative geometry. A stale gesture is caught
  by the existing revision and fingerprint checks.
- Performance: the view-constraint computed keeps structural equality, so
  streaming tab writes still produce no layout work.
- Verification seam: `canvas-workspace-grid.component.spec.ts`.
  - Replace the "compact never resizable" cases.
  - New cases:
    - a compact resize stop with `h = 4` calls `setCompactHeight(id, 4)` and
      reconciles;
    - `h = 9` clamps to 5;
    - a full-tile resize still commits a span and ignores `h`;
    - a locked grid refuses the resize start;
    - a units change under lock applies geometry once with frozen
      measurements.
- Files: MODIFY
  `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` and its
  `.spec.ts`.

### 7. Canvas tile menu (canvas-tile)

- Purpose: offer presets and a stepper for height, both enabled under lock.
- Responsibilities:
  - Replace `VIEW_MODE_OPTIONS` (`:66-74`) with `HEIGHT_PRESETS`:
    - `{ id: 'full', short: 'Full', label: 'Full' }`;
    - `{ id: 'compact', units: 2, short: 'Compact', label: 'Compact' }`;
    - `{ id: 'tall', units: 3, short: 'Tall', label: 'Compact tall' }`.
    - Use `MIN_COMPACT_TILE_HEIGHT_UNITS` for 2.
    - Checked state: full when `!isCompactMode()`; otherwise the preset whose
      `units` equals `compactHeightUnits()`. No preset is checked for a custom
      height.
    - Presets keep the `data-view-mode` attribute (value = preset id) so the
      e2e selectors at `canvas.spec.ts:672` and `:682` still separate height
      items from geometry items.
  - Stepper, rendered only when compact: a row
    `[−] {{ units }} rows [+]` inside the Height group. Buttons are
    `role="menuitem"` with `data-layout-item` and `data-height-step`, carry
    aria-labels "Decrease tile height" and "Increase tile height", and are
    disabled at the bounds (not under lock). Clicking calls
    `tabManager.setCompactHeight(tabId, units ± 1)` and keeps the menu open.
    The presets close it, as today.
  - `compactHeightUnits = computed(() => clampCompactHeightUnits(tabManager.getTabCompactHeightUnits(tabId())))`.
  - `requestHeightPreset(preset)`: full calls `setViewMode(tabId, 'full')`;
    otherwise it calls `setCompactHeight(tabId, preset.units)`.
  - `NEXT_VIEW_MODE_LABEL` (`:76-82`) shrinks to the two modes. The header
    toggle is unchanged.
  - Update the `layoutLocked` doc (`:363-369`) to say height controls are the
    exception.
- Failure behaviour: `setCompactHeight` validates input; the stepper cannot
  exceed the bounds.
- Accessibility: the existing menu keyboard model (`:586-635`) picks up the
  stepper through `data-layout-item`. Up and Down reach it. Left and Right
  stay within `data-layout-group="height"` if the stepper sits inside that
  group; put it in a separate `data-layout-group="height-step"`.
- Verification seam: `canvas-tile.component.spec.ts`.
  - Replace the `compact-tall` cases.
  - New cases:
    - the Tall preset calls `setCompactHeight(id, 3)`;
    - the stepper appears only when compact, increments and decrements, and
      is disabled at 2 and 5;
    - presets and stepper are enabled under `layoutLocked`;
    - a custom height of 4 checks no preset.
- Files: MODIFY `libs/frontend/canvas/src/lib/canvas-tile.component.ts` and
  its `.spec.ts`.

### 8. Electron e2e canvas spec

- Purpose: keep Playwright coverage honest.
- Responsibilities:
  - `canvas.spec.ts:559-563`: a compact tile has 3 handles. East and west stay
    hidden; south is attached (visible on hover under autohide).
  - Add a test: drag the south handle of a compact tile down by one cell; the
    geometry `h` becomes 3 and the neighbour reflows. Then lock and assert
    that no handle is visible and the stepper `+` changes `h` to 4 with no
    gesture commit (`data-canvas-gesture-commits` unchanged).
  - The `:670-686` counts stay (3 presets for a full tile). Confirm after the
    change.
- Files: MODIFY `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`.
- `webview-e2e-harness` has no compact or canvas scenario, and none is added.
  Visual confirmation of R1 and R2 goes to a visual-reviewer pass on a
  running build.

## Integration architecture

- Data flow (content):
  1. `TabState.streamingState` or `messages`;
  2. `summarizeLive` / `summarizeFinalized` (chat-ui, pure);
  3. `CompactSessionSummary` with marks (`toolName`, `excerpt`) and content
     (`format`);
  4. `CompactSessionActivityComponent` renders via `MarkdownBlockComponent`
     (prose), an interpolated `<pre>` (snippet) or `<p>` (plain), and tool
     rows via `ToolIconComponent` plus util badge classes.
- Data flow (height):
  1. drag stop, a menu preset or the stepper;
  2. `TabManagerService.setCompactHeight`;
  3. `TabState.compactHeightUnits` persists through the debounced
     `saveTabState` (key-driven);
  4. the grid's `viewConstraints` clamps it into `heightUnits`, which changes
     the fingerprint;
  5. `computeLayout` and `projectTileGeometry` recompute;
  6. `applyAuthoritativeGeometry` calls `grid.load` (under lock, the frozen
     measurements path).
- State ownership:
  - Height belongs to the tab (chat-state), like `viewMode`.
  - Width and order belong to canvas intent (unchanged).
  - Card split sizes stay component-local signals (unchanged).
- External boundaries: persisted tab JSON is external input. The new field is
  validated in `sanitizeRestoredTab`, and canvas clamps it again on read.
- Failure and rollback:
  - A rejected or invalid resize reconciles to authoritative geometry.
  - A failed storage write follows the existing back-off
    (`tab-manager.service.ts:2498-2546`); in-memory height stays
    authoritative.
- Observability: the existing grid host attributes
  (`data-canvas-gesture-commits`, `data-canvas-apply-passes`,
  `canvas-workspace-grid.component.ts:92-97`) cover resize acceptance and
  rejection. No new logging.

## Architecture-level quality requirements

- Functional: AC1-AC9 in `task.md`.
- Performance: no new timers, observers or per-row animations. Streaming tab
  writes must not change `viewConstraints` identity (structural equality is
  kept). Excerpt work is bounded (8 lines or 600 characters) before regex
  redaction.
- Security:
  - No `[innerHTML]`. Snippets are interpolated text.
  - Markdown goes only through `MarkdownBlockComponent`.
  - Absolute paths are redacted in every mark and content string.
- Maintainability:
  - `chat-ui` imports nothing from `chat`.
  - `canvas-layout-intent.ts` drops its chat-types import.
  - Tool naming and target logic has one definition (the util), shared by the
    header and the compact card.
  - `'compact-tall'` is removed rather than left as a dead union member.
- Testability, as behaviour:
  - the recap selection rules (prose over recovered error, snippet for an
    unresolved error, no output in marks);
  - the header output is unchanged;
  - height clamp, persist and migrate;
  - resize commit and lock refusal;
  - menu presets and stepper under lock.

## Team-leader handoff

- Recommended executors:
  - Lane A (components 1-3): frontend-developer. Angular chat-ui, pure
    builder plus template.
  - Lane B (components 4-8): frontend-developer. Canvas, Gridstack and tab
    state.
  - senior-tester for the e2e run.
  - visual-reviewer for recap and feed screenshots against the normal view.
- Complexity: MEDIUM.
  - Lane A is a contract change inside one lib with a pure core.
  - Lane B crosses chat-types, chat-state, chat (a comment and a spec) and
    canvas, and touches Gridstack gesture code with an e2e dependency.
- Dependencies and ordering:
  - Lanes A and B are independent.
  - Within A: component 1, then 2, then 3.
  - Within B: component 4 before 5 and 6 (types), 5 before 6 and 7, and 8
    last.
- Parallel-safe work: Lane A (`libs/frontend/chat-ui/**`) and Lane B
  (`libs/frontend/chat-types/**`, `libs/frontend/chat-state/**`,
  `libs/frontend/chat/src/lib/components/templates/chat-view.component*`,
  `libs/frontend/canvas/**`, `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`)
  share no files.
- Suggested batches (file-disjoint):
  - **Batch A — compact content rendering (chat-ui):** components 1, 2, 3.
  - **Batch B1 — tab height state:** component 4.
  - **Batch B2 — canvas adjustable height:** components 5, 6, 7.
  - **Batch B3 — e2e:** component 8.
- Files affected:
  - CREATE:
    - `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.ts`
    - `libs/frontend/chat-ui/src/lib/utils/tool-target.utils.spec.ts`
  - MODIFY, Lane A:
    - `libs/frontend/chat-ui/src/lib/molecules/tool-execution/tool-call-header.component.ts`
    - `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-summary.ts` and its `.spec.ts`
    - `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-session-activity.component.ts` and its `.spec.ts`
  - MODIFY, Lane B:
    - `libs/frontend/chat-types/src/lib/chat-types.ts`
    - `libs/frontend/chat-state/src/lib/tab-manager.service.ts`
    - `libs/frontend/chat-state/src/lib/tab-persistence.ts`
    - `libs/frontend/chat-state/src/lib/tab-restore-sanitize.spec.ts`
    - `libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts`
    - `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`
    - `libs/frontend/chat-state/src/lib/tab-manager.persistence.spec.ts`
    - `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` (comment only) and its `.spec.ts`
    - `libs/frontend/canvas/src/lib/canvas-layout-intent.ts` and its `.spec.ts`
    - `libs/frontend/canvas/src/lib/canvas-layout.service.ts` (doc comment)
    - `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` and its `.spec.ts`
    - `libs/frontend/canvas/src/lib/canvas-tile.component.ts` and its `.spec.ts`
    - `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`
- Verification points:
  - After Batch B1, `grep -rn "compact-tall" libs apps` returns only the
    migration constant and its spec.
  - `nx test chat-ui`, `nx test chat-state`, `nx test chat`, `nx test canvas`
    and `nx test tribunal-panel` pass. tribunal-panel consumes
    `isCompactViewMode`.
  - `nx lint` for the same projects passes (module boundaries).
  - `nx typecheck`, or `ptah_get_diagnostics` on the changed files, is clean.
  - The Electron e2e `canvas.spec.ts` passes.
  - Assumptions A1 and A2 are confirmed in the e2e run.
