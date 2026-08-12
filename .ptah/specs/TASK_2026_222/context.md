# Context — glyph-margin hunk markers never visually verified

## Origin

`TASK_2026_173` Batch 9 register, item 16 of 17. Raised in `batch-8b-report.md` §7.4. Filed per NFR-9.
Same underlying cause as item 12 (`TASK_2026_218`): no live Electron host was reachable in any Batch 8
pass.

## Finding (from the register)

> Nobody has ever SEEN the glyph-margin markers. Sizing, colours and the `color-mix` fallbacks are
> asserted only as class names in jsdom; whether a marker is visible and legible in light, dark and
> high-contrast themes is unverified by anyone. Same root cause as item 12 — no live host was reachable
> in any pass.

## Fix

Fold a three-theme (light / dark / high-contrast) glyph render with screenshot capture into the
Electron smoke test filed as item 12 (`TASK_2026_218`), so the visual claim is made once by a machine
rather than never.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 16; `TASK_2026_173/batch-9-dispatch.md` §4.1;
`TASK_2026_173/batch-8b-report.md` §7.4; `TASK_2026_218` (the Electron smoke harness this item
verifies against).
