# Remaining unpartitioned view state on AppStateManager

## Origin

`TASK_2026_195` fixed the reported symptom — `currentView` and `openViews`
surviving a workspace switch — by introducing a `ViewSlice` map keyed by
workspace path on `AppStateManager`, driven from
`WorkspaceCoordinatorService.switchWorkspace`.

That task's scope item 4 asked for an audit of the remaining surfaces. Its
`context.md` records the audit as never re-checked. This is that item, scoped
down to the two cases confirmed to exist at commit `c389aefe4`.

## The two survivors

`libs/frontend/core/src/lib/services/app-state.service.ts`:

```
:258   private readonly _thothActiveTab = signal<ThothActiveTabId>('memory');
:265   private readonly _marketplaceActiveProvider = signal<string | null>(null);
:316   readonly thothActiveTab = this._thothActiveTab.asReadonly();
:318   readonly marketplaceActiveProvider = this._marketplaceActiveProvider.asReadonly();
:564   this._thothActiveTab.set(tab);
:569   this._marketplaceActiveProvider.set(id);
```

Neither is touched by `switchWorkspace` (`:437`–`:500`), so both carry the
previous workspace's selection across a switch.

## These have real consumers

This is the material difference from `_openViews`, which 195 partitioned
defensively despite having no reader outside `app-state.service.ts`. These two
are actually read:

- `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts`
  (+ its spec)
- `libs/frontend/marketplace/src/lib/marketplace-state.service.ts`

So the stale value is user-visible, not merely latent.

## The pattern is already settled

Three independent implementations of workspace partitioning now exist, and
they agree:

- `libs/frontend/canvas/src/lib/canvas.store.ts:68` — internal partition,
  switch entry at `:227`
- `libs/frontend/tribunal-panel/src/lib/services/tribunal-state.service.ts:73`
  — per-workspace slices, effect at `:123`
- `app-state.service.ts:142` — `IMPLICIT_WORKSPACE_PATH` sentinel, `ViewSlice`,
  `DEFAULT_VIEW_SLICE`, lazy seeding, retained slices

Follow the third — it is in the same file and the same service. In particular
reuse its two decided behaviours rather than re-deciding them: slices are
**retained** (returning to workspace A restores A's selection) and seeded
**lazily** (a never-visited workspace gets the default, not an inherited
value).

The likely shape is to widen `ViewSlice` to carry these two fields rather than
to add two more parallel maps. Confirm that against the code before
committing to it — `ViewSlice` currently models the view pointer specifically.

## Constraint carried over from TASK_2026_195

`AppStateManager` lives in `libs/frontend/core`, which **cannot import
`chat-state`**. The "observe `TabManagerService`'s signal" mechanism that
canvas and tribunal use is therefore unavailable here. 195 resolved this by
having `WorkspaceCoordinatorService` call `appState.switchWorkspace(newPath)`
directly, last in its existing synchronous fan-out
(`workspace-coordinator.service.ts:138`), so the surface flips only after the
state behind it belongs to the new workspace. Extend that call; do not
introduce a second mechanism.

## Explicitly not in scope

`layoutMode` stays global. 195 established that workspace switching exists
only in Electron, that Electron pins layout to `'grid'` in
`ElectronShellComponent`'s constructor, and that the toggle which would flip
it sits inside the `@if (!isElectron)` branch at
`app-shell.component.html:434`. It cannot differ between two workspaces on any
reachable path. There is a test pinning that decision — do not reverse it.

## Verification bar

195's tests were mutation-checked and this one's should be too: a test that
asserts the new code path was called is not enough. Exercise a real workspace
switch and assert the previous workspace's Thoth tab and marketplace provider
do not survive it, then confirm the test fails when the fix is stubbed out.
