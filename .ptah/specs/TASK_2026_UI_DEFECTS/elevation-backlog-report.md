# Design elevation — backlog migration report

## Backlog files

| File | Status | Surface class / reason |
| --- | --- | --- |
| `harness-builder/.../setup-hub.component.ts` | migrated | `surface-1`, `surface-2`, `surface-3` |
| `harness-builder/.../harness-config-preview.component.ts` | migrated | `surface-2` collapses |
| `harness-builder/.../harness-builder-view.component.ts` | skipped | Existing follow-up flow; no safe root replacement made in this pass. |
| `tasks-ui/.../board/task-list.component.ts` | migrated | `surface-1` header, `surface-3` menu |
| `tasks-ui/.../board/task-column.component.ts` | migrated | `surface-1` column |
| `tasks-ui/.../detail/task-detail.component.ts` | migrated | `surface-1` detail shell |
| `tribunal-panel/.../wizard/step-run.component.ts` | migrated | `surface-2` inset |
| `tribunal-panel/.../wizard/step-pick-move.component.ts` | migrated | `surface-2` inset |
| `tribunal-panel/.../wizard/step-panel-preview.component.ts` | migrated | `surface-2` inset |
| `tribunal-panel/.../components/conductor-tile.component.ts` | migrated | `surface-1` panel |
| `tribunal-panel/.../components/crucible-verdict-panel.component.ts` | migrated | `surface-2` insets |
| `git-ui/.../commit/commit-composer.component.ts` | skipped | Remaining base fill is code/content treatment, not a structural panel. |
| `git-ui/.../branch-picker/branch-picker-dropdown.component.ts` | migrated | `surface-3` overlay |
| `git-ui/.../branch-picker/branch-details-popover.component.ts` | migrated | `surface-3` overlay |
| `git-ui/.../review-canvas/changed-file-tree.component.ts` | skipped | Base fill is the canvas/content background. |
| `git-ui/.../review-canvas/hunk-toolbar.component.ts` | skipped | Remaining base fill is toolbar content treatment. |
| `git-ui/.../review-canvas/file-section-header.component.ts` | skipped | No ad-hoc structural base/border card match. |
| `canvas/.../tile-agent-mini-panel.component.ts` | skipped | Remaining base fills are inline metadata/content. |
| `canvas/.../tile-agent-indicator.component.ts` | skipped | Remaining base fill is compact indicator/status treatment. |
| `mcp-apps-page/.../apps-surface-panel.component.ts` | skipped | Remaining base fills are warning semantics. |
| `mcp-apps-page/.../apps-page.component.ts` | skipped | Remaining base fills are page/error status semantics. |
| `setup-wizard/.../welcome.component.ts` | skipped | Needs a separate interaction-state review; selected-state base fills retained. |
| `setup-wizard/.../scan-progress.component.ts` | migrated | `surface-2` resume card |
| `setup-wizard/.../prompt-enhancement.component.ts` | skipped | No safe root replacement made in this pass. |
| `setup-wizard/.../generation-progress.component.ts` | skipped | Needs separate wizard-card state review. |
| `setup-wizard/.../completion.component.ts` | migrated | `surface-2` completion inset |
| `setup-wizard/.../cards/enhanced-prompts-summary-card.component.ts` | migrated | `surface-2` card |
| `setup-wizard/.../analysis-results.component.ts` | migrated | `surface-2` collapse |
| `setup-wizard/.../agent-selection.component.ts` | skipped | Selected/unselected base fills encode selection state. |

No backlog file fell under the explicitly excluded chat markdown/mermaid, plan-limits,
provider-account-card, streaming/handler/transcript, or budget-banner paths.

## Files changed

16 interface files across `harness-builder`, `tasks-ui`, `tribunal-panel`, `git-ui`,
and `setup-wizard`, plus this report.

## Checks

- `ptah_get_diagnostics`: TypeScript compiler check did not complete within 45 seconds;
  no diagnostics result was available.
- `npx nx typecheck <each changed project> --parallel=1`: started sequentially for the
  five changed projects; the runner returned no completion output, so this is recorded
  as inconclusive rather than passing.
- Focused Jest and lint were not run: no behavior or specs changed, and the typecheck
  completion result was unavailable.

## Decisions

- Structural cards, panels, and overlays use existing `surface-1`, `surface-2`, or
  `surface-3` classes; no token or primitive was added.
- Status, warning, selection, code/content, and inline metadata fills remain unchanged.
- No accessibility attributes, bindings, test ids, or interaction behavior changed.
