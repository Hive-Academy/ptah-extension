## Frontend implementation — `TASK_2026_701_9e4b`, batch 22

**Tasks completed**: 22.1 (`ProvenanceBadgeComponent`, `DivergedReasonComponent`, card and drawer)

**Files** (all under `libs/frontend/skill-synthesis-ui/src/lib/components/clones/`):

- CREATED `provenance-badge.component.ts`: C7 badge. Text comes from `provenanceLabel`. Plugin origins get `border-primary`, other origins `border-[color:var(--surface-border-strong)]`, on `bg-base-300 text-base-content`. A turned-off or uninstalled plugin also gets the status word "Plugin turned off" (ghost) or "Orphaned" (warning). The host is `display: contents`.
- CREATED `provenance-badge.component.spec.ts`
- CREATED `diverged-reason.component.ts`: C8 reason line, `divergedReasonText` + "Your edits are kept in the Library copy.". It renders nothing for `source-changed` or an absent reason. The file also exports the pure helper `divergenceUpstreamNote`.
- CREATED `diverged-reason.component.spec.ts`
- MODIFIED `clone-card.component.ts`: the badge is first in the meta row. The status hint now depends on provenance. Added the reason line, the plugin-state sentence, the reworded upstream note, and the origin in the accessible name.
- MODIFIED `clone-card.component.spec.ts`: new `describe('provenance')` block.
- MODIFIED `clone-detail-drawer.component.ts`: the badge is first in the header meta row. Added Origin and Reason rows to the divergence box, the plugin-state sentence, and the reworded upstream note.
- MODIFIED `clone-detail-drawer.component.spec.ts`: new `provenance and diverged reason` describe block.
- MODIFIED `clone-action-gating.spec.ts`: new A-hint and orphan describe block.

## Quality requirements -> evidence

| Requirement | Evidence |
| --- | --- |
| Badge first in the card meta row | `clone-card.component.ts:215` (first child of `clone-card-meta`). Spec: `clone-card.component.spec.ts:271` |
| Badge first in the drawer | `clone-detail-drawer.component.ts:155` (first child of `drawer-meta`). Spec: `clone-detail-drawer.component.spec.ts:239` |
| Text from `provenanceLabel` | `provenance-badge.component.ts:74`. Card accessible name: `clone-card.component.ts:201,524-525`. Drawer Origin row: `clone-detail-drawer.component.ts:606` |
| Hint no longer says "no upstream source" when provenance exists | Status hint: `clone-card.component.ts:148-151` (`STATUS_HINT_WITH_ORIGIN`). Upstream note: `diverged-reason.component.ts:43` (`divergenceUpstreamNote`), used at `clone-card.component.ts:535` and `clone-detail-drawer.component.ts:609`. Specs: `clone-card.component.spec.ts:304,318`, `clone-detail-drawer.component.spec.ts:280` |
| A-hint: `hasUpstreamSource` gating unchanged | `clone-action-gating.ts` is not edited. `clone-action-gating.spec.ts:171`: `hasUpstreamSource` and `cloneActionModel` give the same result with or without provenance. `:200`: every agreement-fixture clone is gated the same as its bare copy. Card and drawer still offer no Rebase on a diverged authored entry (`clone-card.component.spec.ts:318`, drawer spec `:280`) |
| Orphan shows the former label | `clone-action-gating.spec.ts:185` (label "Plugin: Former Helper", excluded from bulk rebase). `provenance-badge.component.spec.ts:65`, `clone-card.component.spec.ts:348`, `clone-detail-drawer.component.spec.ts:305` (adds "Orphaned" and the "no longer installed" sentence) |
| Agreement specs import `@ptah-extension/shared/testing` | `clone-card.component.spec.ts:7`, `clone-detail-drawer.component.spec.ts:3`, `clone-action-gating.spec.ts:2`, `provenance-badge.component.spec.ts:6`, `diverged-reason.component.spec.ts:3` |
| Pure presentational components | Both new components use only `input()` + `computed()`, with no `inject` and no outputs. They are standalone, OnPush, with no `@Input`/`@Output`/NgModule and no `any` |
| Accessible, dark and light | The status word is text, so state is never shown by colour alone. The badge has an "Origin: …" title, and the card's `aria-label` includes the origin. Only theme tokens are used (`bg-base-300`, `text-base-content`, `border-primary`, `--surface-border-strong`, DaisyUI `badge-warning`/`badge-ghost`), the pairs measured in design-spec 6.2 for both themes |

**Stack observed**: Angular standalone/OnPush with signal inputs (`clone-card.component.ts`). Tailwind + DaisyUI. `--surface-border-strong` is defined at `apps/ptah-extension-webview/src/styles.css:154` and the arbitrary class is already matched at `:3352`. Provenance types and functions come from `libs/shared/src/lib/types/library-provenance.ts` (read only, not changed). Fixtures come from `libs/shared/src/testing/fixtures/library-agreement.ts`.

**Design fidelity**: `prototype/library.html` sections A and D and design-spec 3.6/3.7/section 5. Deviations:
1. The drawer Reason row shows the full card sentence, including "Your edits are kept in the Library copy.", so there is one C8 sentence instead of two variants.
2. The drawer Origin row shows the label only. The prototype's "written to <path>" cannot be shown because `CloneSummary` carries no path.

**States covered**:
- A diverged entry with a specific reason shows the reason line.
- `source-changed` or no reason: no line and no Reason row.
- A turned-off or uninstalled plugin shows the status badge plus its own sentence.
- An absent provenance shows "Workspace file", and the original hint and note stay unchanged.

## Decisions

- **Hint wording when provenance exists.** Options were to hide the hint, or to use origin-led copy. I chose `Origin: <label>. <status text without upstream claims>`. Evidence: plan 1291 and design 3.6 say the origin label is the source of truth. Reversible: one constant at `clone-card.component.ts` (`STATUS_HINT_WITH_ORIGIN`).
- **Where the reworded upstream note lives.** I could not edit `clone-action-gating.ts` (outside batch ownership, and A-hint applies). So the rewording is a pure helper, `divergenceUpstreamNote`, in `diverged-reason.component.ts`, shared by the card and the drawer. The gated value (`cloneActionModel().upstreamNote`) is only reworded, never suppressed. Reversible.
- **Plugin-state copy.** The status word goes in the badge component. The `orphanedText` sentence goes in the card and drawer, following the design-spec 3.6 table and prototype cards 104-111.

**Verification**:
`npm run verify -- -p @ptah-extension/skill-synthesis-ui,ptah-extension-webview`
- Result: `NX 6 tasks: 5 succeeded, 1 failed`, and the only failure is `✖ nx run ptah-extension-webview:lint`, the accepted pre-existing failure.
- skill-synthesis-ui lint, test and typecheck passed, as did webview test and typecheck.
- The filtered log has no "Running target" header line, because Nx printed only the summary for this run.
- `ptah_get_diagnostics` on the four changed sources found nothing in them. The 5 sibling errors it listed are BigInt target errors in `libs/shared`, which come from the tool's compiler target; they are pre-existing and I did not touch them.

**Plan deviations**: none. `skill-clones-view`, the state service and the model editor belong to Batch 23.

**Out-of-scope observations**: `clone-action-gating.ts` NO_UPSTREAM_NOTE still says "no upstream source" for entries without provenance. That is intended under A-hint and left as is.
