# B7 — F6 first-frame transcript scroll

## Changes

- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:1295-1312`: activation restore now uses `afterNextRender({ write })` with the component injector. The write checks `scrollGeneration` and `workActive()` before setting the pinned bottom or saved offset. The component is 1397 lines, within the 1398-line limit.
- `chat-transcript.component.ts:361-363,1231-1235,1278-1281,1337-1343`: a pending restore ref is destroyed by `cancelScrollFrame()` on a later restore, deactivation, destroy, or user scroll. Pinned content-follow defers its rAF while an activation restore is pending, so the follow effect cannot cancel the first-frame write. The other rAF paths remain unchanged.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.scroll-restore.spec.ts:89-143`: six TestBed cases cover first-render pinned restore without advancing rAF, saved unpinned offset, deactivation, replacement by a second restore, user scroll, and destroy before the render pass. The markdown stub includes the selector lint suppression used by `chat-transcript.session-enter.spec.ts`.

## Phase order

`TranscriptSessionEntrance` registers `earlyRead` then `write` (`transcript-session-entrance.ts:43-49`). Angular runs all `earlyRead` callbacks before any `write` callbacks. Thus entrance `earlyRead` runs before the activation restore's `write`, and entrance's marking `write` also runs in that render pass. Its D11 projection at `transcript-session-entrance.ts:67-72` shifts the measured viewport by `scrollHeight - clientHeight - scrollTop`, which still describes the post-restore pinned position. The comment there describes the old later-frame timing, but the calculation remains valid; that file is outside B7 ownership. Unpinned entrance uses a pane fade without that projection (`:63-65`).

## Verification

No Jest, Nx, TypeScript, lint, Playwright, or diagnostics check was run because the Electron performance recording has exclusive use of the machine. The edited TypeScript files were inspected structurally with `ptah_ast_analyze`; both parsed, and the component line count was checked. The existing B4 specs were not changed.

Exact Jest command for the orchestrator, from the worktree root:

```powershell
npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.scroll-restore.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.session-enter.spec.ts libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.spec.ts --coverage=false --maxWorkers=2
```

## Decisions

- **Retain a cancellable `AfterRenderRef`.** Options were generation-only cancellation or storing the ref. The existing `cancelScrollFrame()` owns scroll work cancellation, and explicit destruction also prevents stale callbacks after deactivation or destroy. This is reversible by relying on the generation guard alone.
- **Defer pinned follow while restore is pending.** Options were to let its rAF cancel the restore, or to let the restore's write establish the pinned position first. The content-follow effect schedules rAF on activation (`chat-transcript.component.ts:1132-1149`), so deferring it preserves the first-frame guarantee. This is reversible if follow scheduling is later separated from activation.
