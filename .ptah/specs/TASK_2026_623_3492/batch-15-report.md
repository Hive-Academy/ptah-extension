# Frontend implementation — `TASK_2026_623_3492`, batch 15

**Tasks completed**: 15.0, 15.1, 15.2, 15.3 (15.3 decided "no export": `src/index.ts` is unchanged)

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-node.component.ts: the switch now wires `avatar`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-node.component.spec.ts: the kind count goes from 20 to 21, and an `avatar` entry is built under `/4`.
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-container-width.spec.ts: the R3.5 container-width proof.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\trust-boundary.spec.ts: adds the `/4` accordion, avatar, trend and spark cases, plus a scan for style and URL bindings.
- NOT MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\index.ts (Task 15.3 decision below).

## Task 15.0: avatar in the node switch (decision #49)

- Changes in `surface-node.component.ts`:
  - It imports `DashboardAvatarComponent` and adds it to `imports`.
  - It adds `'avatar'` to `SURFACE_NODE_KINDS`, which now holds 21 kinds.
  - It adds an `avatarNode` computed, typed `Signal<AvatarNode | null>`, in the same shape as the sibling `*Node` computeds.
  - It adds `@case ('avatar') { @if (avatarNode(); as avatar) { <ptah-dashboard-avatar [node]="avatar" /> } }`. Only `[node]` is bound, because the atom has no other inputs and avatars have no selection target.
  - The doc comment now reads "the 19 `/3` kinds plus the `/4` `accordion` and `avatar`".
- The renderer's own guard (`isRenderableNode`, `surface-renderer.component.ts:140`) reads `SURFACE_NODE_KINDS`, so an avatar surface now passes it. The view model gives every avatar `selectable: false`, so it meets the guard's `selectable` check. Before this change an avatar surface failed closed.
- Spec: `EVERY_KIND` gains `k-avatar` (`name: 'code-explorer', subtitle: 'lane'`), built with `SURFACE_CATALOG_VERSION_4`. The test expects `ptah-dashboard-avatar [data-testid="avatar-initials"]` and 0 failures, and `SURFACE_NODE_KINDS.size` is now 21.
- The "unknown kind emits renderFailed" case still passes.

## Task 15.1: container-width spec (R3.5)

jsdom has no layout engine, and the Jest transform strips component styles. The spec therefore applies the cascade itself, using the real stylesheet text rather than a copy of the formula:

1. It parses `SURFACE_CONTAINER_GRID_STYLES` (imported from the layout component) into rules, each tagged with its `@container dp (min-width: N)` condition.
2. For each rendered grid it picks the matching rules with `element.matches`, sorts them by specificity and then source order, and takes the winning `grid-template-columns`.
3. It resolves `--dp-cols` and `--dp-gap` from the same cascade.
4. It evaluates `calc`/`min`/`max` with a small recursive-descent parser over px, rem and plain numbers. It uses no `eval` or `Function`.
5. It counts auto-fit tracks as `floor((W + gap) / (track + gap))`, with a minimum of 1.

One host renders the same `/4` surface twice, in a `300px` wrapper and a `960px` wrapper. The surface has a 4-column grid of 4 avatars and a 4-column grid of 4 stats. The container width is taken from the wrapper of the `ptah-surface-renderer.dp-root` element; with no `dp-root` there is no container, so no `@container` rule applies.

The spec has four tests:

- **Guard test.** Every selector in the stylesheet is class-only, and the container conditions are exactly `[360, 700, 700]`. If someone adds a selector or condition that the model cannot handle, this test fails loudly instead of the other tests passing silently.
- **300 px vs 960 px.**
  - At 300 px the root grid, the avatar grid and the stat grid each have 1 column.
  - At 960 px the avatar grid reaches its `columns` ceiling of 4. The stat grid and the root grid cap at the stat ceiling of 3 (D9).
  - The test also asserts the `dp-root` host and that each root child is `col-span-full`, which is why each nested grid's width equals the container width.
- **Ceiling and monotonicity.** From 200 to 2000 px in 10 px steps, the avatar grid never exceeds 4 columns, never loses a column as the width grows, and has 1 column below 360 px. At 500 px it has 3 columns, because the 128 px track floor applies.
- **`'viewport'` mode unchanged.**
  - No renderer has `dp-root`, and no element has `.dp-grid`.
  - The root class set is exactly `VIEWPORT_ROOT_CLASS`, and both nested grids are exactly `grid grid-cols-1 sm:grid-cols-4 gap-4`.
  - The class sequence of the whole tree is identical at 300 px and 960 px.
  - Classes are compared as sets, because Angular's `[class]` binding does not keep token order. The first run failed on exactly this, and the fix was in the spec only.

The visual review (V1) remains the authoritative check, as the plan says (`implementation-plan.md:612-615`).

## Task 15.2: trust-boundary spec for the new kinds

The new describe block is `trust boundary: /4 accordion, avatar, trend and spark`, with a new `v4()` helper beside `v2()`.

- **Literal rendering.**
  - Accordion title, avatar name and subtitle, and stat title all carry the 538 markup fixture. A second avatar carries `javascript:alert(1)` plus the fields the contract does not have: `url`, `image`, `src`, `href`, `html`, `style` and `class`.
  - The test asserts that every text renders literally. The initials are the literal output of `avatarInitials(...)` on the hostile strings, and the disc is `aria-hidden`.
  - The trend pill text is exactly `Trend up 4.2%, bad`.
  - The sparkline `aria-label` is the literal `${markup} trend, 3 points: 1, 2, 3; latest 3`.
  - The bar classes are the atom's literals. The latest bar is `dp-spark-bar--failing` because polarity is `bad` (decision #51).
- **Closed accordion.** The body is `inert`, `aria-expanded="false"`, and its agent text is still literal.
- **Fail closed (9 cases).** These cases put agent text into a closed field:
  - trend `direction`, `amount`, `percent`, `polarity`;
  - a `direction` of `__proto__`;
  - a spark point given as markup, and one given as a URL;
  - an avatar name, and an avatar subtitle, sent as a rich-text object.

  Each case is nested in an accordion. The test asserts that `renderFailed` fires, that no surface root renders, and that neither the markup nor the URL appears in the text.
- **Every DOM case runs two checks:**
  - `expectInert`, which already rejects `img, script, iframe, object, embed, style, [style], a[href]` and any `on*` attribute;
  - the new `expectNoAgentAttributes`, which rejects any `href|src|srcset|xlink:href|url|image|html|style` attribute, any non-`aria-label` attribute holding the URL or `<img`, any `a`, `image` or `use` element, and the injected `agent-injected` class. `aria-label` is the one exempt attribute: the accessible name repeats the title as an inert literal value, and that value is pinned exactly.
- **Source scan.** The avatar, sparkline, stat, layout and node component templates, comment-stripped with the existing TypeScript printer helper, contain no `[style]`, `[style.x]`, `[attr.style]`, `[ngStyle]`, `[href]`, `[src]`, `[srcset]`, `[xlink:href]` or `[innerHTML]` binding.

## Task 15.3: barrel exports (decision: none needed)

`avatarInitials` and `avatarTone` are not exported from `src/index.ts`:

- The `$agents` rows reach the screen only through the surface pipeline. The resolver emits surface components, the grammar maps `avatar` to `avatar` (`implementation-plan.md:465`), and `DashboardAvatarComponent` inside the renderer draws them. The initials and tone rule is therefore applied in exactly one place, inside this lib.
- A search across the worktree finds no consumer outside the lib: `avatarInitials`, `avatarTone` and `AVATAR_TONES` appear only in `dashboard-avatar.component.ts`, its spec, and now `trust-boundary.spec.ts`, which is inside the lib. The chat lib's `provider-connection-card.state.ts` has its own unrelated `AVATAR_TONES`. Neither the plan nor the design spec names any other call site.
- Exporting the functions would add public API with no consumer, against the simplicity rule, and would trigger the style review that batches.md ties to 15.3. If a later batch (for example Batch 21 or 25) needs the rule outside the renderer, that batch should add the export.

**Stack observed**:

- Angular standalone components with OnPush and signal `input()`/`computed()` (`surface-node.component.ts`).
- Container styles are plain CSS strings in `styles` (`surface-layout.component.ts:39-59`), with Tailwind/DaisyUI classes elsewhere.
- Tests use Jest with TestBed host components (`surface-node.component.spec.ts`, `trust-boundary.spec.ts`).

**Design fidelity**: No visual change. The avatar renders through the Batch 14 atom without modification.

**States covered**:

- Avatar: renders, and fails closed on a bad name or subtitle.
- Accordion: open and closed (inert) states under hostile text.
- Viewport mode and container mode at 300 px and 960 px.

**Verification** (memory-safe, scoped):

- First run, the exact batch command:
  - Jest: 1 failure. The viewport class-order assertion broke because `[class]` reorders tokens. I fixed the spec.
  - `nx typecheck @ptah-extension/declarative-dashboard`: "Successfully ran target typecheck".
  - `nx lint`: 0 errors, 127 warnings. This equals the Batch 14 baseline, so there are no new warnings.
- Second run, the same three specs plus lint, filtered:
  - Jest: "Test Suites: 3 passed, 3 total; Tests: 46 passed, 46 total".
  - Lint: "0 errors, 127 warnings", "Successfully ran target lint".
- The typecheck was not repeated, because the only change after it was inside a spec file, which the lib tsconfig does not cover. Jest compiled the spec without error.
- No build, serve or e2e target was run.

**Plan deviations**: None.

- At 960 px, "the ceiling" is asserted as the grid's own `columns` (4) for a non-stat grid, and as the D9 stat ceiling (3) for the stat grid and the root grid. The plan's seam mentions 900 px; batches.md says 960 px, and the spec uses 960 px.

**Risks and edge cases handled**:

- **Grid at 300 px is one column** (R3.5 overrides the 128 px design minimum): asserted for the root, avatar and stat grids, and in the width sweep for every width below 360 px.
- **`/3` regression and the Apps viewport layout (HIGH):** the viewport test pins the exact class sets, the absence of `dp-root` and `.dp-grid`, and markup that does not depend on width.
- **Avatar surfaces failing closed (decision #49):** closed by Task 15.0. The trust spec renders avatars with 0 `renderFailed`, both nested in an accordion and at the root.
- **Unknown kind:** it still emits `renderFailed`, and the existing node spec case passes.
- **Decision #51 (failing series):** pinned in the trust spec. `polarity: 'bad'` gives the latest bar `dp-spark-bar--failing`.
- **The jsdom limitation:** handled by applying the real stylesheet in the spec, with a guard test so that an unmodelled selector or condition fails instead of passing silently.

**Out-of-scope observations**: None.
