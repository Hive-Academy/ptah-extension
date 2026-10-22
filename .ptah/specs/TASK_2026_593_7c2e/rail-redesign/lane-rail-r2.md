# Canvas rail Needs you — visual revision 2

## Changes and spec cases

1. **Primary action hierarchy.** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:202-204` and `canvas-rail-card.component.ts:180` now bind `btn-primary` and `btn-ghost` exclusively, with `btn-sm`, using the existing `isPrimaryAttentionAction` rule. `canvas-rail.component.spec.ts:91` and `canvas-rail-card.component.spec.ts:260` check the exclusive classes for a disabled decision and its promoted open action.
2. **Framed session request.** `canvas-rail-card.component.ts:115-129,172-209` places the compact card and Needs you block in one rounded, bordered surface. The inner compact card frame is suppressed inside that surface, while the outer frame takes the selected state. `canvas-rail-card.component.ts:73` reserves extra height when three actions or multiple requests may wrap. `canvas-rail-card.component.spec.ts:240-258` checks that both the compact card and attention block are within the framed container.
3. **Queue text order.** `canvas-rail.component.ts:194-199,381-383` renders the icon with an uppercase label derived from `item.kind`, then the session title, then one detail line. It no longer renders `item.title` as a separate row. `canvas-rail.component.spec.ts:108-130` covers permission, question, and lane permission labels and checks that request titles do not repeat the detail.

## Decisions

- `CompactSessionCardComponent` has no content projection slot; the attention surface uses a shared wrapper and a reusable `NgTemplateOutlet` for the existing card. Sessions without attention keep their original direct card layout.
- The visual review's snackbar finding belongs to the notification-center lane and was left untouched here.

## Verification and limits

- `git diff --check -- libs/frontend/canvas/src/lib/canvas-rail` found no whitespace errors.
- Scoped `ptah_get_diagnostics` reported no diagnostics in the four changed canvas files. It reported nine existing errors in sibling core/shared files.
- Nx, Jest, TypeScript CLI, lint, build, and Electron visual capture were not run, as instructed. The revised frame still needs visual review in Electron.
