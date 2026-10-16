# Batch F3 visual fixes

## Fix 1: leave dialog inertness and focus

- `libs/frontend/harness-builder/src/lib/components/harness-builder-leave-dialog.component.ts:137,176-195`: the dialog now adds `inert` only to siblings without that attribute and removes it only from those siblings on destroy. The builder view remains the owner of its header, main, and sidebar bindings; the dialog loop still blocks siblings when opened from the Hub switch path. The `narrow() && sheetOpen()` binding on main is unchanged.
- `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts:33,70-71,198-206,469-519`: the view spec mounts the real dialog and covers Cancel, Escape, and backdrop dismissal, checking no `inert` remains in the ordinary view and focus returns to Start over. A narrow sheet case checks that main remains inert and focus returns.

## Fix 2: neutral empty proposal state

- `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.ts:147-149,174-198,246-249,273-275,293-330,414-420`: remembers proposal records and live revisions seen for each workspace and session. A null RPC result for a never-proposed session leaves an empty `ready` preview. A missing previously seen proposal, or a returned record rejected by validation or scope checks, produces `unavailable` when no revision or snapshot can be shown. Retry recomputes the missing state from its new read. RPC failures retain the existing `error` state.
- `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.spec.ts:133-150`: added cases for a bound session that never proposed and a previously seen proposal that is absent on re-entry. The existing cross-workspace record case still expects `unavailable`.

## Fix 3: preset select edge and focus

- `libs/frontend/harness-builder/src/lib/components/sidebar/builder-presets-section.component.ts:44`: gives the select's `/50` border an important override, including DaisyUI's `.select:focus` rule, and gives keyboard focus the theme primary outline. DaisyUI already supplies the 2 px outline and 2 px offset. No other visual style was changed.
- No CSS unit spec was added; contrast and focus appearance require the orchestrator's visual check.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep dialog sibling blocking but only own siblings it changes | Remove view inert bindings; remove dialog loop; track dialog-owned siblings | View bindings cover the builder but the dialog can open during a Hub switch. The old restore overwrote Angular's removal of the header attribute. | Yes, local dialog change. |
| Use observed proposal presence as the missing-record signal | Treat every bound session as saved; use a durable record reference; remember observed proposals | Bound session IDs identify chats, not proposals. Builder records contain a user snapshot but no proposal reference. `getProposal` can return null before any proposal exists; a valid record or live revision proves one existed. | Yes, local service change. |
| Override DaisyUI's select edge and focus color in the class list | Rely on `border-base-content/50`; add component CSS; use important utilities | DaisyUI's `.select-bordered` and `.select:focus` rules set a 20% base-content edge and focus outline. The review measured insufficient contrast. | Yes, one class change. |

## Not done and limitations

- The in-memory known-proposal signal cannot recognize a proposal lost before a fresh application runtime has observed it; there is no durable proposal reference in the allowed records.
- No Nx, Jest, TypeScript, lint, build, serve, or e2e command was run, per edit-only scope. I did run `git diff --check` once by mistake; it produced no output. The orchestrator must run verification.
