# Batch C1 report

## Files changed

- `libs/frontend/command-center/src/lib/components/command-node-detail.component.ts`
- `libs/frontend/command-center/src/lib/components/command-node-detail.component.spec.ts`

## Acceptance

- Selected detail now uses the approved Cinzel 28px name, compact state badge, kind subtitle, and 11px monospace metadata. Known provider IDs use registered artwork; unknown IDs use a decorative monogram and keep the raw ID visible.
- The root omits its repeated subtitle and task body. Other nodes show a first-line task preview only when it differs from the displayed subtitle. Elapsed time, phase, freshness, and messages/tokens/active/cost render only when their existing inputs provide values.
- The child card shows provider, state, freshness and live figures when supplied. A persisted child with no supplied provider, timestamp or stats shows none of those unavailable fields. No child tab action, navigation, output, or tab availability copy was added.
- The same read-only component remains in the rail and pinned overlay. It adds a semantic heading and decorative artwork, with no focusable controls. Parity rows 17 and 20 are preserved.

## Tests and verification

- Added four component cases: root omission; live child fields and duplicate task suppression; raw-ID provider fallback; and accessible, static persisted-child detail without unavailable fields. Existing escaping, provisional-figure, and elapsed-time cases remain.
- Prettier completed on both edited files. Ptah AST parsing succeeded for both. Scoped `ptah_get_diagnostics` found no diagnostics in either requested file; it reported 29 errors in sibling files outside C1 ownership.
- No Nx, Jest, build, or other heavy run was started, per the parallel-lane check rule. The orchestrator owns the phase checks.

## N1 wording conflicts

None. Existing asserted strings such as `Updated 3m ago`, `7 messages`, `~12.3k tokens`, and `~$0.01` remain.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use kind-derived subtitles and suppress a matching task line. | Kind subtitle; task-only body; new node field. | `CommandWorkNode` has `kind` and `task`, but no subtitle; the approved screenshot shows a kind description and design-spec parity row 20 says Task appears only when distinct. | Yes; presentation-only computed values. |
| Format known provider IDs using the nearby overlay/list convention, while displaying unknown IDs raw. | Existing title-case convention; raw IDs for all providers; new registry mapping. | `command-overlay.component.ts` and `command-work-list.component.ts` title-case known display names; design-spec requires unknown IDs to retain their raw spelling. | Yes; display-only. |
| Keep the selected-card outer eyebrow and panel shell with their current owners. | Edit page/overlay wrappers; keep C1 to the shared detail component. | C1 ownership is limited to the detail component and spec; A2b/D3 own those wrappers. | Yes. |
