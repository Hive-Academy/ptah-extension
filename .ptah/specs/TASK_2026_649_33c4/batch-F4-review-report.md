# Batch F4 review report

Edit only. No Nx, Jest, TypeScript, lint, build, serve, or e2e command was run.

| Item | Valid? | Change | Specs |
| --- | --- | --- | --- |
| 1. Proposal root authorization | Yes | `libs/backend/rpc-handlers/src/lib/harness/config/harness-proposal-store.service.ts:181` now resolves a supplied root through `findOpenWorkspaceRoot` after existing syntax validation, rejects a closed root, and uses the open folder's spelling. The workspace provider was already injected. `proposeConfig` passes its policy workspace root to both turn capture and save; open secondary folders are accepted even when the active root differs. | `harness-proposal-store.service.spec.ts:228` accepts an equivalent pinned root and checks stored spelling; `:242` rejects a closed root before filesystem access. The existing multi-folder pinned-root spec now supplies open folders. |
| 2. Sidebar counts | Yes | `libs/frontend/harness-builder/src/lib/components/sidebar/builder-sidebar-helpers.ts:21` counts enabled agents plus selected and created skills, matching `HarnessConfigPreviewComponent`. Both `harness-builder-sidebar.component.ts:152` and `sidebar/builder-preview-section.component.ts:52` use it. | `sidebar/builder-sidebar-helpers.spec.ts:4` covers disabled agents and created skills. |
| 3. Missing context percent | Yes | `libs/frontend/harness-builder/src/lib/components/sidebar/builder-session-section.component.ts:57` appends `%` only for a present context value; cost formatting is unchanged. | `sidebar/builder-session-section.component.spec.ts:5` covers the unavailable summary. |
| 4. Preset name and Claude MD | Yes | `libs/frontend/harness-builder/src/lib/services/harness-builder-records.service.ts:11` adds `name` and `claudeMd` to `HARNESS_CHOICE_FIELDS`. `builder-presets-section.component.ts` sends the preset config through `commitBuilderUpdates`; that function's selection loop, snapshot Zod field schema and validation, and hydration's `applyChoice`/D9 precedence loop all derive from this same tuple. Older records with only the original fields remain valid because snapshot `fields` is a partial record. | `harness-builder-records.service.spec.ts:63` loads a preset via `commitBuilderUpdates`, checks snapshot persistence, and checks `fullConfig(hydration.config())` retains `generateProjectClaudeMd=false`, custom sections, and name. The existing round-trip snapshot spec covers a record without the new fields. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Authorize supplied roots against open folders and store the matched folder path | Accept any absolute path; restrict to active root; match any open folder | `findOpenWorkspaceRoot` is the handler's existing rule; the store receives `IWorkspaceProvider`; Electron supports multiple folders; `sameWorkspaceRoot` handles Windows casing | Yes |
| Share one count helper | Keep duplicate computed formulas; shared helper | Both formulas disagreed with the preview's enabled-agent and created-skill counts | Yes |
| Extend the existing choice tuple | Add special preset handling; extend tuple | Snapshot schema, commit selection, hydration recompute and choice precedence already iterate the tuple | Yes |

## Not done

No checks were run, per edit-only instruction. No files outside the listed scope were changed intentionally.
