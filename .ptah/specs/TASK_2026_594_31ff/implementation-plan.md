# Implementation plan — semantic status and static-text kinds

Revision: 3

## Changes from revision 1

* F1 — **Renderer design / View-model projection** now adds a v2-only
  `StatusNode` and mapper, so the six valid components never enter the v1-only
  `mapDisplayNode` throw path.
* F2 — **Contract design / Badge selection** adds the closed `badge` selection
  target through validation, equality, description, renderer state, and prompt.
* F3 — **Renderer design / Tone map** uses bare `progress` for neutral.
* F4 — **Renderer design / Tone map** explicitly maps divider orientation.
* F5 — **Renderer design / Tone map** requires complete literal Tailwind-safe
  class records and exact-class tests.
* F6 — **Renderer design / Accessibility contracts** permits only
  renderer-owned radial `--value`.
* F7 — **Exact schema and validation seam** uses the Zod-4-compatible badge
  action object.
* F8 — **Agent-facing documentation and tool contracts** uses exact token/set
  completeness assertions.
* F9 — **Team-leader handoff** splits batches, adds per-component specs,
  enumerates G, and builds stats before the closure gate.
* F10 — **Renderer design** renames renderer classes to `Dashboard*Component`.
* F11 — **Version and catalog boundary** states the actual `/2` unknown-version
  failure and cross-pair test.
* F12 — **Agent-facing documentation and tool contracts / Team-leader handoff**
  places the asset-reading catalog spec in `vscode-lm-tools`.
* F13 — **Team-leader handoff / B** replaces the broken alias identity/count
  assertions.
* Round-1 N1 — **Team-leader handoff / A2** assigns the shared badge
  selection and fallback regressions to their existing spec homes.
* Round-1 N2–N4 — **Version-literal disposition / Team-leader handoff**
  restores absolute source paths, makes the renderer edit conditional on
  typecheck, and expands final verification to all eight AC-15 projects.
* F14 — **Eager-closure boundary / H** preserves the lazy placement and adds
  the required build step.

## Scope and evidence

This plan changes the v2 surface catalog only: six display kinds are added while
`dashboard-spec/2` remains the surface schema. The user approved the only
contract choices: reject `dashboard-spec/2` + `dashboard-catalog/2` after the
bump, allow only `dashboard.select` on badges, and keep both progress values
literal (`context.md:115-121`).

Verified — the current v2 catalog aliases `SURFACE_DISPLAY_KINDS` to the v1
`DASHBOARD_COMPONENT_KINDS` (`libs/shared/src/mcp-apps-contracts/surface-catalog.ts:35`),
which would incorrectly expand the v1 tool/schema if reused. v1's five kinds
and its `dashboard-catalog/1` version are independently owned in
`dashboard-catalog.ts:42-64`. The renderer dispatch is an OnPush standalone
recursive component with static imports inside declarative-dashboard
(`components/surface-node.component.ts:78-92,135-185`), and v2 rendering is
already guarded as all-or-nothing (`view-model/surface-view-model.ts:108-119,177-190`).

Rules used below are tagged as follows: **[user-requested]** is the approved
task description/context; **[project-rule: source]** is a repository or project
rule with its cited source; **[lane-proposed]** is a design choice introduced by
this plan.

## Contract design

### Version and catalog boundary

**Decision — [user-requested] [project-rule: `surface-catalog.ts:10-21`]**

* Keep `SURFACE_SCHEMA_VERSION` exactly `'dashboard-spec/2'`; change
  `SURFACE_CATALOG_VERSION` to exactly `'dashboard-catalog/3'`.
* Keep `DASHBOARD_SCHEMA_VERSION`, `DASHBOARD_CATALOG_VERSION`,
  `DASHBOARD_SUPPORTED_*`, and `DASHBOARD_COMPONENT_KINDS` untouched. They are
  the v1 contract and must continue to expose exactly `stat`, `table`, `list`,
  `line-chart`, and `bar-chart` (`dashboard-catalog.ts:42-64`).
* Replace the v2 display alias with an explicit `SURFACE_DISPLAY_KINDS` tuple:
  the five existing display kinds followed by `alert`, `badge`, `progress`,
  `radial-progress`, `divider`, and `text-block`. `SURFACE_COMPONENT_KINDS`
  continues to concatenate layout, input, and this v2 tuple.
* Keep the pair table as the only legality source, with exactly:

| Schema version | Catalog version | Accepted vocabulary |
| --- | --- | --- |
| `dashboard-spec/1` | `dashboard-catalog/1` | five v1 display kinds |
| `dashboard-spec/2` | `dashboard-catalog/3` | existing v2 kinds plus six new kinds |

`dashboard-spec/2` + `/2` is deliberately absent and therefore rejected by
`validateSurfaceEnvelopeVersions`; no compatibility shim is added. This serves
AC 7–10. The rejected alternative—adding the kinds to
`DASHBOARD_COMPONENT_KINDS`—would silently change the public v1 tool and
violates AC 8.

Because `/2` is absent from `SURFACE_SUPPORTED_CATALOG_VERSIONS`, its negative
test must expect the validator's **unknown catalog** branch: `ok: false`,
`field: 'catalogVersion'`, and a reason that names `/3` as supported
(`surface.validator.ts:145-153`), not the later pair-mismatch branch. Separately
test `dashboard-spec/1` + `dashboard-catalog/3` reaches the "does not pair"
branch. `surface.validator.ts` needs no production edit. [project-rule:
`surface.validator.ts:113-162`]

### Exact new TypeScript contracts

**Decision — [user-requested] [project-rule: `surface.types.ts:18-22,91-111`]**

Add these readonly interfaces (using `SurfaceRichText`/the established plain
text `DashboardRichText`, not strings) and append them to `SurfaceComponent`:

```ts
interface SurfaceAlertComponent {
  readonly id: string; readonly kind: 'alert';
  readonly tone: 'info' | 'success' | 'warning' | 'error';
  readonly text: SurfaceRichText; readonly title?: SurfaceRichText;
}
type SurfaceBadgeAction = Omit<SurfaceAction, 'action' | 'url'> & {
  readonly action: 'dashboard.select';
};
interface SurfaceBadgeComponent {
  readonly id: string; readonly kind: 'badge';
  readonly tone: 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'error';
  readonly text: SurfaceRichText; readonly actions?: readonly SurfaceBadgeAction[];
}
interface SurfaceProgressComponent {
  readonly id: string; readonly kind: 'progress';
  readonly value: number;
  readonly tone: 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'error';
  readonly label: SurfaceRichText;
}
interface SurfaceRadialProgressComponent extends Omit<SurfaceProgressComponent, 'kind'> {
  readonly kind: 'radial-progress';
}
interface SurfaceDividerComponent {
  readonly id: string; readonly kind: 'divider';
  readonly direction: 'horizontal' | 'vertical'; readonly text?: SurfaceRichText;
}
interface SurfaceTextBlockComponent {
  readonly id: string; readonly kind: 'text-block';
  readonly text: SurfaceRichText; readonly role: 'heading' | 'body';
}
```

`SurfaceBadgeAction` is a narrow action type whose `action` literal is
`'dashboard.select'`; it deliberately omits `url` (legal only for
`dashboard.open-url`) while retaining the established id/label/params shape.
It adds no action. The duplicate progress shape remains two named public
discriminants for clear renderer narrowing. [lane-proposed]

### Exact schema and validation seam

**Decision — [user-requested] [project-rule: `surface.schemas.ts:182-190,325-400`]**

Add six named `z.object(...).strict()` schemas, each using `componentId()` and
`DashboardRichTextSchema` (the existing bounded plain-RichText validator), and
include them in `SurfaceComponentSchema`'s discriminated union. They must not
spread `displayShape`: that shape admits title/description/actions intended for
legacy displays (`surface.schemas.ts:325-330`).

| Schema | Exact keys | Closed validation |
| --- | --- | --- |
| Alert | `id`, `kind: z.literal('alert')`, `tone`, `text`, optional `title` | `tone: z.enum(['info','success','warning','error'])` |
| Badge | `id`, `kind: z.literal('badge')`, `tone`, `text`, optional `actions` | six-tone `z.enum`; `actions` is max `SURFACE_LIMITS.maxActionsPerComponent` of `SurfaceBadgeActionSchema` |
| Progress | `id`, `kind: z.literal('progress')`, `value`, `tone`, `label` | six-tone enum; `value: z.number().finite().min(0).max(100)` |
| Radial | same as progress with `kind: z.literal('radial-progress')` | same literal numeric rule |
| Divider | `id`, `kind: z.literal('divider')`, `direction`, optional `text` | `z.enum(['horizontal','vertical'])` |
| Text block | `id`, `kind: z.literal('text-block')`, `text`, `role` | `role: z.enum(['heading','body'])`; `text.text` non-empty and at most `SURFACE_LIMITS.maxStringLength` |

For Zod 4 compatibility, extract the existing action `params` schema to an
`actionParams()` factory. Define `SurfaceBadgeActionSchema` as a new strict
object—`id: componentId()`, `action: z.literal('dashboard.select')`,
`label: DashboardRichTextSchema`, and `params: actionParams().optional()`—with
no `url`; do not refine or extend `SurfaceActionSchema`, whose refinement does
not narrow its output type. Badge actions are
`z.array(SurfaceBadgeActionSchema).max(...).optional()`. [project-rule:
`surface.schemas.ts:134-180`; lane-proposed]

All objects are strict, so `class`, `style`, `html`, binding fields (`path`,
`data`), unknown enums, and every other extra key reject the entire document.
For text-block, add a local/derived non-empty RichText schema rather than
loosening the shared title schema: its special non-empty requirement is a
component rule. This preserves the fail-closed Zod intake used by
`validateSurfaceDocument` (`surface.validator.ts:122-154,640`) and gives the
webview the same rejection behavior. No budget constant changes: every new
field uses existing component, string, and byte limits. Add boundary tests in
`surface-budgets.spec.ts`, rather than widening a limit. [project-rule:
`surface-catalog.ts:78-100`; user-requested]

### Fallback, failures, and tests

**Decision — [user-requested] [project-rule: `surface-text-fallback.ts:18-31,34-80`]**

Extend the v2 `renderDisplay` switch with exactly one safe text line per new
node: `Alert (<tone>): <text>`; `Badge: <text>`; `Progress: <label> — <value>%`;
`Radial progress: <label> — <value>%`; `Divider: <text>` or `Divider`; and
`Heading: <text>` / `Text: <text>` for text-block. Values are accepted finite
integers or decimals and rendered as `${value}%`, not rounded. This is a
presentation fallback only; it does not introduce data bindings.

The existing validator returns a version/schema failure before parsing and
`buildSurfaceViewModel` catches hostile in-process shape errors to return
`renderFailed` without partial output. New validation tests cover valid minimal
components, every closed enum, badge action rejection, finite/range/type
rejection, forbidden/additional keys, empty/overlength text block, v1 rejection
of new kinds, `/2` pair rejection, `/1` unchanged, and text fallback lines.

### V2 view-model projection and badge selection

**Decision — [project-rule: `view-model.types.ts:21-25`; `dashboard-view-model.ts:37-81`]**

`DisplayNode` and `mapDisplayNode` stay v1/legacy-display-only. Add a separate
`StatusNode` in `view-model.types.ts`: the union of the six new shared component
interfaces intersected with `{ readonly selectable: boolean }`; include it in
`SurfaceNode`, but not `DisplayNode` or `DashboardViewModel`. In
`buildSurface`, add explicit cases for all six status kinds before `default`.
They call a v2-only mapper which copies only declared contract fields and
performs fixed-text defensive checks: a finite numeric `value` for both
progress kinds; closed tone, direction, and role membership; `isRichText` for
all RichText fields; and an action-array/`dashboard.select` check for badge.
It returns `StatusNode`. Legacy kinds alone continue to use `mapDisplayNode`.
This prevents valid new kinds from reaching `dashboard-view-model.ts:80-81` and
preserves the existing all-or-nothing `renderFailed` response for hostile
in-process values. [user-requested]

Badge selection extends the established closed protocol, rather than pretending
that stat selection fits. Add `{ kind: 'badge' }` (no index) to
`SurfaceSelectionTarget` and `SurfaceSelectionTargetSchema`; add `badge` cases
to `checkSurfaceSelection` (require `component.kind === 'badge'`),
`sameSelection`, and `describeSurfaceSelection` (`Text: <badge text>`,
`Tone: <tone>`). Update the exhaustive target handling in
`surface-renderer.component.ts`. The badge component emits this target and
sets `aria-pressed` from it, mirroring stat selection. Tests accept a badge
target and reject that target on a non-badge. This keeps Q2's action restriction
while making its one allowed action host-valid. [user-requested; project-rule:
`surface-patch.ts:370-436`]

## Renderer design

**Decision — [user-requested] [project-rule: Angular guidance; `dashboard-stat.component.ts:9-44`]**

Create six standalone, `ChangeDetectionStrategy.OnPush` presentational
components beside existing dashboard components: `DashboardAlertComponent`,
`DashboardBadgeComponent`, `DashboardProgressComponent`,
`DashboardRadialProgressComponent`, `DashboardDividerComponent`, and
`DashboardTextBlockComponent` (with matching `ptah-dashboard-*` selectors).
Each takes `Extract<StatusNode, { kind: ... }>`—not `DisplayNode`, which is
v1-only—and uses interpolation only: never `innerHTML`, an agent/caller class,
or agent-supplied style. Keeping progress variants
separate avoids a mode input which would be a speculative public abstraction;
their tiny shared type-only helper may be introduced only if it removes real
duplicated ARIA calculation. [lane-proposed]

`surface-node.component.ts` owns the integration: add imports, six kind guards,
the six values to `SURFACE_NODE_KINDS`, and switch cases. This preserves the
current recursive dispatcher ownership and avoids introducing a renderer
registry.

Tone-to-Daisy mapping is defined **only inside these renderer component files**:

| Kind | Semantic tone → class |
| --- | --- |
| alert | `alert-info`, `alert-success`, `alert-warning`, `alert-error` |
| badge | `badge-neutral`, `badge-primary`, `badge-info`, `badge-success`, `badge-warning`, `badge-error` |
| progress | `progress` for neutral; `progress progress-primary`, `progress progress-info`, `progress progress-success`, `progress progress-warning`, `progress progress-error` otherwise |
| radial progress | `radial-progress text-neutral`, `radial-progress text-primary`, `radial-progress text-info`, `radial-progress text-success`, `radial-progress text-warning`, `radial-progress text-error` |

Each renderer defines a typed `const` tone map containing **complete literal
class strings** (for example `info: 'alert alert-info'`), looked up through
`[class]`/`[ngClass]`. No template or string concatenation such as
`'alert-' + tone` is permitted, so Tailwind's content scan sees every class.
For the divider map explicitly use `horizontal: 'divider'` and
`vertical: 'divider divider-horizontal'`: daisyUI's `divider-horizontal`
draws a vertical rule. It carries `role="separator"` and
`aria-orientation` equal to the contract direction. Text block uses ordinary
typography/base-content tokens. Do not put mappings in the shared contract,
tool description, or skill. Daisy semantic classes resolve through theme
tokens, so per-kind specs assert every tone's exact class plus rendered text
under both existing theme roots; no hard-coded colour utilities are added.
[user-requested; project-rule: `tailwind.config.js:6-9`; lane-proposed]

Accessibility contracts:

* Alerts render tone words in accessible text. `warning`/`error` use assertive
  announcement (`role="alert"`); `info`/`success` use `role="status"`. If no
  title exists, emit no heading/title node; with title, render it before text in
  the same alert element.
* Progress and radial progress expose `role="progressbar"`,
  `aria-valuemin="0"`, `aria-valuemax="100"`, exact `aria-valuenow`, and an
  accessible label from `label`; visible label remains text.
* Badge selection is the only interactive case: render an accessible button
  and emit the existing `SurfaceSelection`/`dashboard.select` pathway rather
  than inventing an action channel. Non-action badges are noninteractive.
* Divider and text block use native/semanic elements; heading role renders a
  heading element and body a paragraph. [project-rule: task-description.md:62-65]

The radial component alone may bind `[style.--value]="node().value"`; this
numeric custom property is renderer-owned and sourced from the already
validated finite `0..100` number. It is not an agent-supplied style channel.
Its spec asserts the custom-property value. [lane-proposed]

### Eager-closure boundary

**Verified — [project-rule: `scripts/eager-closure-gate.js:1-25`]** The gate
walks `main.js` static imports and fails if declarative-dashboard, the shared
surface contract, ptah-ui renderers, or chart code enters that initial closure;
with a base stats file it also rejects any unlisted eager growth. It does not
forbid static imports *within* the already lazy declarative-dashboard feature.

Therefore, add the six static renderer imports only to `SurfaceNodeComponent`,
which remains behind the current Apps/declarative-dashboard lazy/deferred
boundary. Do not import a new renderer, its type, or surface catalog value from
an eager webview entry. The implementer must prove this by production webview
build followed by `npm run gate:eager-closure`; if the existing boundary has
moved, restore/use the established lazy route/import rather than adding a gate
allowlist. [lane-proposed]

## Agent-facing documentation and tool contracts

* `buildSurfaceUpdateTool` continues deriving its vocabulary from
  `SURFACE_*_KINDS` and version constants (`surface-tools.ts:159-207`), but its
  prose gains concise fields/ranges/actions for the six kinds and literal
  `dashboard-catalog/3`; it does not carry an independent tuple. Its spec adds
  a completeness assertion that parses the emitted layout/input/display comma
  lists into exact tokens and compares set equality with
  `SURFACE_COMPONENT_KINDS` (not substring inclusion); it also asserts the
  literal `'dashboard-catalog/3'`. **[user-requested]**
* `dashboard-propose-spec.tool.ts` is intentionally unchanged except version
  expectations: it reads the retained `DASHBOARD_COMPONENT_KINDS` for both
  JSON-schema enum and prose (`dashboard-propose-spec.tool.ts:50-114`), proving
  that v1 still lists five. **[user-requested]**
* Extend the existing delivered skill's `SKILL.md` link list and create
  `references/catalog.md`, not a new `.claude` skill. Catalog is a declarative
  reference containing every kind in `SURFACE_COMPONENT_KINDS`, each with
  exactly one fenced valid JSON component example (including all pre-existing
  kinds), plus concise field/action/binding constraints. A focused shared/spec
  test parses its entries, checks set equality/completeness, wraps each example
  in a v2 `/3` envelope, and calls `validateSurfaceDocument`. It keys examples
  by exact headings/fence ids and compares that key set exactly to
  `SURFACE_COMPONENT_KINDS`, so `progress` cannot be satisfied by
  `radial-progress`. **[user-requested;
  context.md:70-75]**
* Add one Apps prompt line naming `ptah-surface-authoring`, listing every kind
  from the surface catalog, and directing the agent to the skill. The prompt
  remains a pointer, not a second per-kind schema. Its spec iterates
  `SURFACE_COMPONENT_KINDS` by parsing the one kinds line into exact tokens,
  and updates the selectable-items line to include badges. **[user-requested;
  `apps-system-prompt.ts:9-27`]**
* Run `npm run manifest:generate` after the catalog reference exists and commit
  the resulting checked-in `content-manifest.json`; `npm run manifest:check`
  is the validity gate. **[user-requested]**

## Version-literal disposition

Use the shared `SURFACE_CATALOG_VERSION` in v2 fixtures/harnesses where imports
are already permitted; edit an intentional literal only where the test asserts
the protocol/version pair or a source-level literal is the subject under test.
All entries below are the exhaustive AC 10 discovery list.

| Site | Decision |
| --- | --- |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/src/di/surface-composition.spec.ts:102` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-electron/src/di/surface-composition.spec.ts:106,117` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/testing/fixtures/surface.ts:31` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface.types.ts:124` | edit literal to `/3` (public v2 type) |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-catalog.ts:11` | edit literal to `/3` (constant definition) |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts:63` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-budgets.spec.ts:50` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts:241,257,263,286` | import constant, retain explicit `/2` negative pair case |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/ptah-ui-converter.spec.ts:132` | edit expected v2 output literal to `/3` |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts:113` | import `SURFACE_CATALOG_VERSION` |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.spec.ts:21` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts:93` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts:30` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.spec.ts:15` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.spec.ts:17` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-choice-input.component.spec.ts:23` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-checkbox-input.component.spec.ts:14` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-text-input.component.spec.ts:23` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts:22` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.spec.ts:49` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.spec.ts:37` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-sync.spec.ts:31` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.spec.ts:74` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.spec.ts:55` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts:46` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.spec.ts:65` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-surface-panel.component.spec.ts:38` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.spec.ts:134` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-page-conversation.spec.ts:126` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/rpc-handlers/src/test-utils/surface-rpc-harness.ts:111` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/cli-engine/src/lib/surface-composition.spec.ts:81,93` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts:53` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.store.spec.ts:23` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.submit.spec.ts:85` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.spec.ts:83` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.failure.spec.ts:43` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.spec.ts:70` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.budget.spec.ts:50` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/di/register.spec.ts:342` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.spec.ts:15` | import constant |
| `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts:39` | import constant |

## Lane-introduced constraints

* New component schemas do not inherit legacy `displayShape`; only the
  properties contractually named are admitted.
* The six `Dashboard*Component` renderer components are intentionally separate
  to keep a fixed DOM, ARIA, and interaction contract per semantic kind.
* Fallback labels above are stable plain text and do not round values.
* Radial progress alone has the renderer-owned numeric `[style.--value]`
  binding; agent-supplied styles remain invalid.
* No eager-closure allowlist modification is authorized; the existing lazy
  boundary must carry the new static renderer files.

## Team-leader handoff

All batches below are file-disjoint. “Parallel” means parallel with other
batches in the same wave after prerequisite wave completion; the final
integration/manifest batch follows source changes. Every listed path is
absolute, and each batch stays within six files and two libraries where
possible.

| Batch / wave | Exact files (CREATE/MODIFY) | AC | Scoped verification |
| --- | --- | --- | --- |
| A1 — catalog/type/schema (wave 1) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-catalog.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface.types.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface.schemas.ts` | 1–5, 7–10 | `npx nx run-many -t typecheck,test,lint -p shared` |
| A2 — fallback/selection (wave 2, after A1) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-text-fallback.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-patch.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-selection.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-patch.spec.ts` (badge target accepts on badge, rejects on non-badge, and equal badge targets compare equal); MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-selection.spec.ts` (badge description emits `Text: <text>` and `Tone: <tone>`); MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-text-fallback.spec.ts` (one exact line per new kind, including textless `Divider` and an unrounded decimal percentage) | 1, 4, 6 | `npx nx run-many -t typecheck,test,lint -p shared` |
| B — shared regressions (wave 3, after A2) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-contract.spec.ts` (replace alias identity/13-count with v1-prefix/no-new-v1/19-count); MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-validator.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/surface-budgets.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/testing/fixtures/surface.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/shared/src/mcp-apps-contracts/ptah-ui-converter.spec.ts` | 1–10 | `npx nx run-many -t typecheck,test,lint -p shared` |
| D0 — v2 projection (wave 2, after A1; prerequisite C/D) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/view-model.types.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.spec.ts` | 1–5, 7–10 | `npx nx run-many -t typecheck,test,lint -p declarative-dashboard` |
| C1 — alert/badge/divider (wave 3, after D0) | CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-alert.component.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-alert.component.spec.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-badge.component.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-badge.component.spec.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-divider.component.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-divider.component.spec.ts` | 1–5 | `npx nx run-many -t typecheck,test,lint -p declarative-dashboard` |
| C2 — progress/radial/text (wave 3, after D0; parallel C1) | CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-progress.component.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-progress.component.spec.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-radial-progress.component.spec.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-text-block.component.ts`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/dashboard-text-block.component.spec.ts` | 1–5 | `npx nx run-many -t typecheck,test,lint -p declarative-dashboard` |
| D — dispatch/selection renderer (wave 4, after C1/C2) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-node.component.spec.ts` (including badge pressed-state); MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts` **only if typecheck requires it**; its generic `target.kind`/`JSON.stringify` equality path otherwise needs no badge edit | 1–5, 15 | `npx nx run-many -t typecheck,test,lint -p declarative-dashboard` |
| E — MCP tool/v1 regression (wave 3, after A1) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.spec.ts` | 8, 11 | `npx nx run-many -t typecheck,test,lint -p vscode-lm-tools` |
| F — skill, prompt, catalog spec (wave 4, after E) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/references/catalog.md`; CREATE `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/surface-catalog-reference.spec.ts` | 12–14 | `npx nx run-many -t typecheck,test,lint -p mcp-apps-page,vscode-lm-tools` |
| G1 — dashboard literal specs (wave 4, after A1; parallel E/F/D) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-choice-input.component.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-checkbox-input.component.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-text-input.component.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/budget-render.spec.ts` | 9, 10, 15 | `npx nx run-many -t typecheck,test,lint -p declarative-dashboard` |
| G2 — Apps literals I (wave 4, after A1; parallel G1) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/state/apps-surface-reducer.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/state/apps-surface-intake.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-sync.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-operations.service.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-surface-lanes.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts` | 9, 10, 15 | `npx nx run-many -t typecheck,test,lint -p mcp-apps-page` |
| G3 — Apps literals II (wave 4, after A1; parallel G2) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/services/apps-submit-flow.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-surface-panel.component.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-page.component.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/mcp-apps-page/src/lib/components/apps-page-conversation.spec.ts` | 9, 10, 15 | `npx nx run-many -t typecheck,test,lint -p mcp-apps-page` |
| G4a — vscode literals I (wave 4, after A1; parallel G1) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.store.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.submit.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.failure.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state-reader.budget.spec.ts` | 9, 10, 15 | `npx nx run-many -t typecheck,test,lint -p vscode-lm-tools` |
| G4b — vscode state-service literal (wave 4, after A1; parallel G4a) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/surface/surface-state.service.spec.ts` | 9, 10, 15 | `npx nx run-many -t typecheck,test,lint -p vscode-lm-tools` |
| G5a — vscode remaining literals (wave 4, after A1; parallel G4) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/di/register.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/surface-namespace.builder.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts` | 9, 10, 15 | `npx nx run-many -t typecheck,test,lint -p vscode-lm-tools` |
| G5b — RPC/CLI literals (wave 4, after A1; parallel G5a) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/rpc-handlers/src/test-utils/surface-rpc-harness.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/backend/cli-engine/src/lib/surface-composition.spec.ts` | 9, 10, 15 | `npx nx run-many -t typecheck,test,lint -p rpc-handlers,cli-engine` |
| G6a — application literals (wave 4, after A1; parallel G1) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-extension-vscode/src/di/surface-composition.spec.ts`; MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/apps/ptah-electron/src/di/surface-composition.spec.ts` | 9, 10, 15 | `npx nx run-many -t typecheck,test,lint -p ptah-extension-vscode,ptah-electron` |
| G6b — dashboard trust literal (wave 4, after A1; parallel G6a) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/libs/frontend/declarative-dashboard/src/lib/trust-boundary.spec.ts` | 9, 10, 15 | `npx nx run-many -t typecheck,test,lint -p declarative-dashboard` |
| H — generated manifest/integration (wave 5, after F and all code) | MODIFY `D:/projects/ptah-extension/.claude-worktrees/task-594-status-kinds/content-manifest.json` (generated only); run `npm run manifest:generate`, `npm run manifest:check`, then the final eight-project command, then `npx nx build ptah-extension-webview` (the configuration with `statsJson: true`), then `npm run gate:eager-closure` | 13, 15 | `npx nx run-many -t typecheck,test,lint -p shared,declarative-dashboard,mcp-apps-page,vscode-lm-tools,rpc-handlers,cli-engine,ptah-extension-vscode,ptah-electron`; then `npx nx build ptah-extension-webview`; then `npm run gate:eager-closure` |

A1 precedes A2, B, and D0. After D0, C1 and C2 run in parallel; D follows both.
E can run after A1; F follows E because its catalog-reference spec shares the
vscode-lm-tools project. G1–G3, G4a–G4b, G5a–G5b, and G6a–G6b are file-disjoint mechanical lanes and may run
in parallel once A1 is complete (subject to the listed project lane capacity).
H is the integration finish after F, D, B, and G lanes complete.

## Risks and failure behavior

* Version drift is contained by importing the one v2 constant and by explicit
  negative `/2` pair coverage; v1 constants remain untouched.
* Unknown or hostile agent fields fail validation before rendering; the renderer
  has no dynamic style/HTML escape hatch.
* A catalog reference omission is caught by parsing/validating every documented
  example against the actual tuple, and manifest drift is caught by check mode.
* If lazy-loading is accidentally bypassed, the eager-closure gate fails rather
  than shipping surface code in initial webview `main.js`.
