# Batch 1B report

## Files changed

- `libs/frontend/command-center/src/lib/model/command-center.store.ts`
- `libs/frontend/command-center/src/lib/model/work-projection.ts` and `work-projection.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-state-icon.ts`
- `libs/frontend/command-center/src/lib/components/command-overlay.component.ts` and its spec
- `libs/frontend/command-center/src/lib/components/command-work-list.component.ts` and its spec
- `libs/frontend/command-center/src/lib/components/command-center-start.component.ts` and its spec
- NEW `libs/frontend/command-center/src/lib/components/command-node-detail.component.ts` and its spec
- NEW `libs/frontend/command-center/src/lib/components/command-relative-time.ts` and its spec

## Acceptance evidence

- Projection carries optional task and exact live child tab ID on `CommandWorkNode` (`model/command-center.store.ts:35-36`, `model/work-projection.ts:116,170,267`). Persisted children have no invented tab ID. `startedAt` was not added. The source already supplied both values (`components/command-center-projection.source.ts:123-135,157-162`); its spec now asserts them.
- Plates and rows have a state-token left edge and retain visible selected border/ring and accessibility state (`components/command-state-icon.ts:30-60`, `components/command-overlay.component.ts:44-52`, `components/command-work-list.component.ts:45-51`). State remains text and icon. Tests cover edge mapping, selected ring, `aria-current`, and `aria-controls`.
- Shared detail renders provider mark/monogram, label, first line of task as escaped and bounded text, state icon/word, phase fraction, freshness, and optional child figures (`components/command-node-detail.component.ts:17-72`). The overlay hover/pin card uses it (`components/command-overlay.component.ts:135-136,175-183`); close button, timing, positioning, and focus code remain in the overlay. Tests cover escaped task, phase, freshness, figures, and pinned card semantics.
- Shared formatter validates timestamp and supplied clock (`components/command-relative-time.ts:2-10`). Start uses it (`components/command-center-start.component.ts:141-143`), as does the work list (`components/command-work-list.component.ts:129-131`). Overlay, list, and start expose a `now` input for the existing page clock; no new timer was added.
- Work rows render `Updated …` only for valid timestamps (`components/command-work-list.component.ts:92-94`), and accept `overflowCompleted` / `overflowOther` scene-layout counts for `+N completed · +N more` (`components/command-work-list.component.ts:105-110,124-125`). Tests cover clock changes, invalid time, counts, and zero-count omission.

## Tests added or extended

- New `components/command-node-detail.component.spec.ts` and `components/command-relative-time.spec.ts`.
- Extended `model/work-projection.spec.ts`, `components/command-center-projection.source.spec.ts`, `components/command-overlay.component.spec.ts`, `components/command-work-list.component.spec.ts`, and `components/command-center-start.component.spec.ts`.
- Scoped `ptah_get_diagnostics` found no diagnostics in requested changed files. It reported 29 errors in unrelated sibling specs. Jest/Nx/typecheck/build commands were not run, per lane instructions.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep full task in the projection; bound and escape it only in detail | Source CLI task is already plain text (`command-center-projection.source.ts:157-162`); the plate label is separately capped in `work-projection.ts:34-48`. This preserves detail without lengthening plates. | Yes |
| Put selected emphasis in a ring while retaining the existing border binding | State edge must remain visible alongside selection; both components already use selected border and ARIA state. | Yes |
| Derive overlay phase fraction from projected phase children | `work-projection.ts:203-246` already supplies actual phase nodes; synthetic unavailable/no-tracking children are excluded. | Yes |
| Use optional inputs for time and scene overflow | The existing 30-second page clock is in `command-center-page.controller.ts:64`; the scene exposes `layout()` with overflow counts. Page/controller paths belong to another lane. | Yes |

## Not done

- The page-owning lane must bind the existing controller clock to `[now]` on overlay, work list, and start, and pass `scene.layout().overflowCompleted` / `.overflowOther` to the work list. The current controller clock is private, so that lane or the orchestrator must expose it through its owned page/controller path. I sent this integration request to the spawner twice. Without these bindings, labels render from their initial input value and overflow remains zero.
- Selected rail adoption of the shared detail body and child stats lookup are Phase 2 V06 work. No tests were executed, as explicitly requested.
