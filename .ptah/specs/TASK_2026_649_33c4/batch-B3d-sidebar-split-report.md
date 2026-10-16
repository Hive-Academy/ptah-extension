# Batch B3d: builder sidebar split

## Files and formatted line counts

| File | Lines | Responsibility |
| --- | ---: | --- |
| `libs/frontend/harness-builder/src/lib/components/harness-builder-sidebar.component.ts` | 157 | Aside shell, fixed header, sole scroll body, setup state, section order, shared document signal |
| `libs/frontend/harness-builder/src/lib/components/sidebar/builder-apply-section.component.ts` | 311 | Apply states, result, paths, health and workspace action |
| `libs/frontend/harness-builder/src/lib/components/sidebar/builder-stack-profile-section.component.ts` | 140 | New Project stack profile |
| `libs/frontend/harness-builder/src/lib/components/sidebar/builder-preview-section.component.ts` | 72 | Preview and propose-again action |
| `libs/frontend/harness-builder/src/lib/components/sidebar/builder-ai-helpers-section.component.ts` | 357 | Helper rows, input, results and preview addition |
| `libs/frontend/harness-builder/src/lib/components/sidebar/builder-presets-section.component.ts` | 262 | Preset list, load and save |
| `libs/frontend/harness-builder/src/lib/components/sidebar/builder-session-section.component.ts` | 61 | Session disclosure and stats |
| `libs/frontend/harness-builder/src/lib/components/sidebar/builder-sidebar-helpers.ts` | 157 | Complete config, preview commit, helper metadata and result text |
| `libs/frontend/harness-builder/src/lib/components/harness-builder-sidebar.component.spec.ts` | 189 | Existing sidebar assertions with child import stubs |

## What moved

The six design sections now have standalone OnPush components. Their existing section markup, classes, aria attributes, text and interactions moved with them. The shell retains the only `flex-1 min-h-0 overflow-y-auto` container. Child instances stay mounted while initialization state changes; their sections are conditionally rendered so local UI state survives setup retry as it did in the original component. The generated text preview still uses `[textContent]`.

Config completion and preview snapshot commits moved into a shared helper because Apply, Presets and AI helpers use the same behavior. Existing catches continue to log the real error through `LoggingService.error`.

## Spec changes

The sidebar spec still contains its scroll layout, apply success, apply failure and helper routing assertions. It overrides preview and stats imports on their new child boundaries. No separate child spec was added because those interactions remain reachable from the sidebar spec.

## Not moved

The aside, fixed header, setup notice, section ordering, sole scroll body and document signal remain in the shell because they coordinate the whole sidebar. No files outside the assigned sidebar source, sidebar spec, new sidebar folder and this report were edited.

## Decisions

- Kept child instances mounted and gated their markup. Destroying children during setup retry would reset state previously held by the sidebar. This is reversible.
- Used one helper file for config completion and preview commits, preserving the former shared methods without duplicating logic across sections. This is reversible.

## Verification

`npx prettier --write` completed for the changed TypeScript files. `ptah_ast_analyze` reports `parseStatus: ok` and zero error nodes for all nine changed TypeScript files. Unit tests, diagnostics, TypeScript compilation and builds were not run, as explicitly prohibited for this batch.

## Orchestrator fix

- `sidebar/builder-ai-helpers-section.component.ts:319`: the split called the module function `helperResultText` without importing it (TS2663). Imported it as `helperResultText as formatHelperResult`, because the class method has the same name.
