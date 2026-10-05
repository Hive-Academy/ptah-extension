# BF1 shared pipeline report

## Completed fixes

1. **Host-value limits.** `ptah-ui-resolver.ts:12,48,208-261` imports `SURFACE_LIMITS`, clamps every resolved host string to `maxStringLength` with a final `…`, and limits host row expansion to `maxTableRows`. Overflow rows are represented in the description. This covers test commands, diff paths, statuses, outcomes, lists (through the same row values), and string-valued stats. Regression coverage: `ptah-ui-resolver.spec.ts:161-215` covers over-limit commands and paths; `ptah-ui-pipeline.spec.ts:219-235` proves the command case through `renderPtahUiBlock`.

2. **Single source-column definition.** `ptah-ui-parser.ts:12-24` exports `PTAH_UI_SOURCES`; `ptah-ui-converter.ts:6,153-155` reads its default columns from that definition. The duplicated converter switch is removed.

3. **Safe validation reasons.** `ptah-ui-pipeline.ts:38,54-62` maps validator diagnostics to `internal error`, `block exceeds a display limit`, `invalid table row`, or `invalid display content`, rather than exposing Zod paths. `ptah-ui-pipeline.spec.ts:136-145` pins the short reason, and its budget case at `194-207` pins the display-limit reason.

4. **Fence closer alignment.** `ptah-ui-fence.ts:126-128` now delegates target-closer recognition to the existing CommonMark-compatible closer check, accepting 0–3 leading spaces and rejecting four. `ptah-ui-fence.spec.ts:23-45` proves that an indented closer ends the block and leaves following prose as markdown, while a four-space line does not close it. This implements the rule from `task-description.md:319`: `fence = "```ptah-ui" NL body "```"`; the closer is recognized with CommonMark’s allowed 0–3-space indentation so a closer honored by Markdown never lets a ptah-ui segment swallow later text.

## Formatting and verification

Ran Prettier on every touched source/spec file.

`npx nx run-many -t typecheck,test,lint -p @ptah-extension/shared --parallel=1`

Observed result: success (exit code 0), 3/3 requested targets passed (`typecheck`, `test`, `lint`), cache `0/3` hits, duration `1m 34s`. Nx’s final non-verbose capture did not emit suite or individual-test totals, so none are inferred here. Nx Cloud emitted a disabled-organization warning after local success; it did not affect the result.
