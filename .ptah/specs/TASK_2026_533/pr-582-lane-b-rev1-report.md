# PR #582 lane B revision 1

Closed D1 (template note), D4 (template), D5, D6, D7, D8 and D9 (template). Only the four assigned source files and this report were edited; existing changes were preserved. No commit was made.

Paths below use `P = apps/ptah-extension-vscode/assets/plugins/ptah-core/skills` and `T = libs/backend/agent-generation/templates/agents`.

| Defect | File:line | Change | Verification |
| --- | --- | --- | --- |
| D1 template note | `T/software-architect.template.md:60` | Inventory-only invocation in flows without a project-manager reads OLD code, writes `parity-inventory.md` with capability, current file:line, backing RPC/API, keep/move/remove-proposed decision, new location and test columns, then stops without a plan. | Reviewed explicit mode trigger, evidence source, columns, output and stop rule. |
| D4 template | `T/team-leader.template.md:95`, `:100`, `:115`, `:348`, `:440` | BUGFIX validation uses the bug report/context and available research. Numbered blockers, evidence and questions return to the orchestrator for Gate SR or researcher-expert; software-architect/Gate 2 is reserved for planned flows. | Reviewed validation table, blocked return and refusal for consistent routing. |
| D5 | `P/ui-ux-designer/SKILL.md:129`, `:132`, `:135`, `:139` | Added local assets; viewing is build-free, authoring generates project-configured CSS; CDN is a disclosed fallback. Actual narrow viewport, embedded sidebar container and wide viewport are separate checks. | Skill validator passed; checked consistency with PROTOTYPING. |
| D6 | `P/ui-ux-designer/PROTOTYPING.md:20`, `:268` | README layout and template include `## Deviations`, with asset provenance, CDN fallback reasons, departures from project tokens/components and capture limitations. | Reviewed template and its entrypoint reference. |
| D7 | `P/ui-ux-designer/PROTOTYPING.md:28`, `:33`, `:51` | Generate CSS with the project's own configuration/CSS entry while scanning prototype HTML; link `assets/app.css` relatively. Explain production CSS purging, regeneration and offline class coverage. Tailwind/daisyUI remains an example with project-native equivalents allowed. | Reviewed CLI example, relative link and skeleton comments for agreement. |
| D8 | `P/ui-ux-designer/PROTOTYPING.md:234`, `:235`, `:236`, `:262` | Serve prototype over local HTTP; document localhost access. Close/reopen sessions with 400x900 and 1440x900 viewports and capture separately; sidebar check occurs in the wide session. | Confirmed advertised `ptah_browser_navigate` accepts HTTP/HTTPS and applies `viewport` at session creation; confirmed `ptah_browser_close` and screenshot `saveTo` parameters. |
| D9 template | `T/team-leader.template.md:299`, `:305`, `:378`, `:445` | Each preserve-list capability must exist in the build with a passing test or appear in approved `## Proposed Removals`. Inventory markers apply only to `parity-inventory.md`; input, completion return and refusal also accept the preserve list. | Reviewed both parity artifact branches and approval requirement. |

## Validation

- `npx nx test agent-generation` (with `NX_DAEMON=false`, output tailed): **FAILED**, exit 1. Tail: `Time: 33.752 s`, `Ran all test suites.`, `Running target test for project @ptah-extension/agent-generation failed`; Nx run duration 39.5 s. The retained 22-line tail does not identify the failing suite/assertion. Nx supplied structured logs at <https://cloud.nx.app/runs/p5FazND0Qo>. The suite was run once and was not rerun to retrieve output.
- `git diff --check`: passed, no output.
- Skill creator `quick_validate.py` on `P/ui-ux-designer`: `Skill is valid!`.
- `{{...}}` placeholders: byte-identical before/after; all four files contained zero such placeholders before and after the edits.
- Line endings: all four edited source files have zero CR bytes (LF).
- No mirrors, orchestration/agent-lanes files, existing specs or `content-manifest.json` were edited by this revision. No browser capture or prototype asset build was run: this task changes guidance and templates, not a prototype.

## Limitations

Validation remains unresolved: the required test run failed; no claim is made that this revision caused it or that it was pre-existing. A targeted search found no retained local terminal log, so the specific assertion could not be diagnosed within the available evidence. Browser execution examples were checked against the advertised tool schema, not executed against a sample prototype.
