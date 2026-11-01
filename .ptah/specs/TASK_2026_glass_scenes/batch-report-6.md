# Batch 6 — Providers glass section planes

## Changed sections

| Providers section | Plane and block rationale | Files |
| --- | --- | --- |
| CLI Agents & Custom Instances Matrix | The labelled `<section data-testid="settings-cli-matrix">` owns one `content` plane. A `<section>` is a block element; it is not a `display: contents` custom-element host. The table wrapper retains its inner `tile` surface. | `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.ts:173,178,202,798`; assertion `cli-orchestration-matrix.component.spec.ts:320` |
| Ptah CLI instances | The existing labelled `<section data-testid="cli-instances">` owns one `content` plane. It sits beside the matrix section under the same flex wrapper, avoiding nested content planes. This native `<section>` is a real block. | `libs/frontend/chat/src/lib/settings/ptah-ai/ptah-cli-instances.component.ts:67,71,404`; assertion `ptah-cli-instances.component.spec.ts:59` |
| Background Model Roles, including role cards and Enhancement time limit | The native outer `<section>` around `<details>` owns one `content` plane. It encloses the cards and timeout row; neither receives a second content plane. The outer `<section>` is a real block, not a modal or drawer host. | `libs/frontend/chat/src/lib/settings/providers/agents-routing-settings.component.ts:102,159`; assertion `agents-routing-settings.component.spec.ts:176` |

The new padding is `1.25rem` only under `:host-context([data-glass='on'])`. The matrix's original `gap-4` remains between the matrix and instances in solid themes. No popover, modal, or drawer received a surface. Batch-5 files were left unchanged.

## Verification

Command: `npm run verify -- -p @ptah-extension/chat -- --output-style=static`. The header identified exactly one project: `@ptah-extension/chat`. Result: exit 0; all 321 test suites passed, with 5,721 tests passed and 2 skipped. Lint passed with 0 errors and 128 warnings; Angular typecheck passed with existing NG8107 warnings. Scoped `ptah_get_diagnostics` did not return a result before its 45-second timeout, but the required typecheck completed successfully.

`ptah_browser_status` found no active browser session. The task forbids starting the app, so a rendered screenshot could not be inspected. Skill discovery/loading was not available in this lane; the repository's Angular conventions and Providers main card guided the edit.

## Decisions

- **Separate matrix and instances planes:** Split the old matrix section into two sibling native sections inside a flex wrapper. The user requested one top-level plane per section, and the original markup nested instances in the matrix section. This is reversible; the original `gap-4` spacing is retained.
