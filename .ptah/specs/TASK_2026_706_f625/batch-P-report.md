# Batch P — Voice panels

| Change | Old | New | File:line |
| --- | --- | --- | --- |
| Desktop rail width, deck gap, dock gap, page gutters | 336px, 16px, 14px, 22px sides | 296px, 12px, 10px, 16px sides | `libs/frontend/command-center/src/lib/components/command-center-page.component.css:2` |
| Rail width at <=1000px | 260px | 240px | `libs/frontend/command-center/src/lib/components/command-center-page.component.css:16` |
| Header height, title, tile, chips and buttons | 78px, text-xl, 40px, 32px chips, 44px buttons | 60px, text-lg, 32px, badge-sm, btn-sm | `libs/frontend/command-center/src/lib/components/command-center-header.component.ts:10` |
| Dock grid gap and padding | 8px by 12px, p-3 | 4px by 8px, p-2 | `libs/frontend/command-center/src/lib/components/command-dock.component.ts:10`, `:59` |
| Mic tile and voice title | 56px, text-sm | 40px, text-xs | `libs/frontend/command-center/src/lib/components/command-voice-hud.component.ts:15`, `:24` |
| Dock controls, field and support text | 44px minimum controls, text-xs support | 40px minimum controls, smaller field, text-[11px] support | `libs/frontend/command-center/src/lib/components/command-session-controls.component.ts:13`, `:23`, `:32` |
| Rail card spacing and reply | gap-3, p-4 selected card, p-3 text-sm reply | gap-2, p-3 selected card, p-2 text-xs reply | `libs/frontend/command-center/src/lib/components/command-center-page.component.html:189`, `:198`, `:230` |
| Selected detail typography | 28px title, 13px body, 11px metadata | 24px title, 12px body, 10px metadata | `libs/frontend/command-center/src/lib/components/command-node-detail.component.ts:61`, `:67`, `:87` |
| Work list density | p-3 card, text-sm rows | p-2 card, text-xs rows | `libs/frontend/command-center/src/lib/components/command-work-list.component.ts:34`, `:79` |

## Spec updates

- `command-center-page.component.spec.ts:569` now asserts the 296px and 240px rails, 16px padding, 12px column gap, and 10px row gap.
- `command-dock.component.spec.ts:24` now asserts compact dock padding, 40px mic tile, smaller support text, and the 4px by 8px grid gap. Existing placement assertions stay in place.

## Decisions

- Kept the selected detail title in `font-display` while stepping its size down to 24px. The current component defines that family and E5 asks for a smaller rail title; reversible.
- Kept all dock grid assignments and container breakpoints. E5 requires the same positions; only sizing classes and grid gaps changed; reversible.
- Left stats band heights, stage minimums, rail scrolling, the 7rem work list minimum, and fill height rules intact because the scene measures or depends on them.

## Not verified

No nx, Jest, build, or test commands were run, by rule. A scoped `ptah_get_diagnostics` request returned unavailable after 45 seconds with all eight TypeScript files unchecked. The orchestrator owns validation.
