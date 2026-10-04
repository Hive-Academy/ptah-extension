# Inline agent bubble CSS sizing report

## Changes

- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts:383-384` — replaced JS textarea sizing with `style="field-sizing: content"`, `min-h-[calc(1lh+0.5rem)]`, `max-h-[72px]`, and `overflow-y-auto`.
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts:1047-1050` — the input handler now only writes the draft signal; removed both textarea `style.height` writes and its `scrollHeight` read.
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts:1076` — send reset remains a signal reset only. No textarea height reset existed there, and programmatic `[value]` updates have no height write.
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.spec.ts:241-265` — added regression coverage for the rendered `field-sizing` style and for preserving a pre-existing `style.height` during input while updating the draft signal.

## Height-write audit

Removed the two textarea height-write sites from the input handler: the `auto` reset and the pixel height assignment based on `scrollHeight`. There are no remaining `style.height` writes or textarea `scrollHeight` reads in this component. The remaining `scrollHeight` reads at lines 738 and 751 belong to the agent-content scrolling logic, not the textarea.

## Min-height reasoning

The textarea has `rows="1"` and DaisyUI `textarea-xs` supplies `padding-top: 0.25rem` and `padding-bottom: 0.25rem` (`node_modules/daisyui/dist/full.css:28256-28263`). `field-sizing: content` ignores `rows`, so the equivalent resting content-box minimum is one line height plus 0.5rem vertical padding: `calc(1lh + 0.5rem)`. The previous three-line 72px cap is retained as `max-h-[72px]`; overflow becomes vertical scrolling beyond it.

## Verification

- `npx jest -c libs/frontend/chat/jest.config.ts inline-agent-bubble --silent 2>&1 | Select-Object -Last 6` — PASS: 1 suite, 18 tests.
- `cmd /c "npx tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit 2>&1" | Select-String -Pattern 'error TS' | Measure-Object | Select-Object -ExpandProperty Count` — `0` errors. This is the PowerShell equivalent of the requested `grep -c`; native `grep` and `tail` are unavailable in this shell.
- Targeted diagnostics — no diagnostics in either changed file.

## Open items

None.
