# Elevation Batch 5 — Marketplace

## Delivered

Marketplace now follows the shared hierarchy: page `surface-0`, storefront and
shell sections `surface-1`, KPI/detail cards `surface-2`, and the selected
skill row plus docked inspector `surface-3`. Status colour treatments remain
status treatments rather than elevation.

## Before → after

| Element                          | Before                                              | After                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storefront hero/source band      | `rounded-2xl border border-base-300 ... p-6`        | `surface-1 rounded-xl ... p-5` ([storefront-surface.styles.ts:12](../../../libs/frontend/marketplace/src/lib/ui/storefront-surface.styles.ts#L12))                                                                                                                                                                                                                                                                                                                                    |
| Overview KPI `StatCardComponent` | `rounded-xl border border-base-300 bg-base-200 p-4` | `surface-2 rounded-xl p-4` ([stat-card.component.ts:75](../../../libs/frontend/marketplace/src/lib/ui/stat-card.component.ts#L75))                                                                                                                                                                                                                                                                                                                                                    |
| Connector category tiles         | `rounded-xl border border-base-300 bg-base-200 p-4` | `surface-2 rounded-xl p-4`; internal divider uses `border-surface-border` ([category-bento.component.ts:131](../../../libs/frontend/marketplace/src/lib/ui/category-bento.component.ts#L131), [category-bento.component.ts:165](../../../libs/frontend/marketplace/src/lib/ui/category-bento.component.ts#L165))                                                                                                                                                                      |
| Connector detail facts           | `rounded-xl border border-base-300 bg-base-200 p-4` | `surface-2 rounded-xl p-4` ([connector-detail.component.html:63](../../../libs/frontend/marketplace/src/lib/pages/connectors/connector-detail.component.html#L63))                                                                                                                                                                                                                                                                                                                    |
| Installed-skill group/active row | `bg-base-200` group and `bg-base-300` active row    | `surface-1` group and conditional `surface-3` active row; icon tile is `bg-surface-0` ([installed-skills-page.component.ts:147](../../../libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts#L147), [installed-skills-page.component.ts:255](../../../libs/frontend/marketplace/src/lib/pages/skills/installed-skills-page.component.ts#L255))                                                                                                          |
| Shell, header, nav, footer       | `bg-base-100` / `border-base-300`                   | page `bg-surface-0`; structural bars `surface-1`; semantic dividers and `hover:bg-surface-2` ([marketplace-shell.component.html:1](../../../libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.html#L1), [marketplace-nav.component.ts:227](../../../libs/frontend/marketplace/src/lib/shell/marketplace-nav.component.ts#L227), [marketplace-status-bar.component.ts:79](../../../libs/frontend/marketplace/src/lib/shell/marketplace-status-bar.component.ts#L79)) |
| Docked inspector                 | `border-l border-base-300 bg-base-100`              | `surface-3` with its original docked edge shape retained ([docked-inspector.component.ts:38](../../../libs/frontend/marketplace/src/lib/ui/docked-inspector.component.ts#L38))                                                                                                                                                                                                                                                                                                        |

## Preserved character

The storefront gradient still uses its existing base and primary stops. The KPI
and category cards retain their existing typography and restrained hover
translation; active category borders remain primary. Warning/error/info/success
surfaces were deliberately not remapped. Search inputs were already `input-sm`
(32px), so no control-density change was needed.

## Specs and verification

- Updated `stat-card.component.spec.ts` to assert the semantic card surface.
- Updated `docked-inspector.component.spec.ts` to assert the raised inspector
  surface.
- `npx jest -c libs/frontend/marketplace/jest.config.ts ...stat-card... ...docked-inspector... ...category-bento... --coverage=false --maxWorkers=2`: **36 passed, 36 total**.
- `npx nx typecheck @ptah-extension/marketplace --parallel=1`: **passed**.
- `git diff --check -- libs/frontend/marketplace`: clean.

## Not done

No overlays/shared UI primitives, app shell, chat, settings, analytics, or
Thoth files were changed. Native drawers remain owned by the shared overlay
batch. Existing Marketplace status alerts retain their semantic status colours.
