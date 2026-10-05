# Batch B5a report — PtahUiLiveWindow

Task folder: `.ptah/specs/TASK_2026_610_6a10` (Batch B5a, tasks B5a.1 + B5a.2 — Req 5.4 window half, decision 10, L-5, component 9).

## Files written

1. CREATE `libs/frontend/chat-ui/src/lib/services/ptah-ui-live-window.ts`
2. CREATE `libs/frontend/chat-ui/src/lib/services/ptah-ui-live-window.spec.ts`
3. MODIFY `libs/frontend/chat-ui/src/index.ts` — added only:

```ts
export {
  PtahUiLiveWindow,
  PTAH_UI_LIVE_CAP,
} from './lib/services/ptah-ui-live-window';
```

## API signatures

```ts
export const PTAH_UI_LIVE_CAP = 8;          // mirrors SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId
export const PTAH_UI_TRACKED_KEY_CAP = 512; // file-level only; not re-exported from the barrel

@Injectable() // plain decorator; NOT providedIn: 'root' — the transcript-scoped component provides it
export class PtahUiLiveWindow {
  register(key: string, orderKey: number): Signal<boolean>;
  release(key: string): void;
  liveCount(): number; // read-only test seam; no production caller
}
```

- `register` returns a `computed<boolean>` reading a shared `_liveKeys` computed (the
  `PTAH_UI_LIVE_CAP` highest-`orderKey` registered keys as a `ReadonlySet<string>`). Pure
  signal graph: `signal` + `computed` only — no timers, no observers, no DOM, no DI deps.
- Re-registering a still-registered key returns the same signal object and updates the
  entry in place.
- `release` drops the per-key signal and marks the entry released; releasing an unknown or
  already-released key is a no-op.

## Ordering and eviction rules

- **Live set**: registered entries ranked by `orderKey` descending; ties broken by
  registration `seq` descending (later registration is "newer"). The top 8 keys are live;
  everything else is a snapshot. Arrival order never matters except as the tie-break, so
  out-of-order registration is safe.
- **Remount position keeping**: each entry carries a monotonic `seq` that survives
  `release`; re-registering a released key (with its original `orderKey`) reuses the
  original entry and seq, so it keeps its original window position instead of taking a
  fresh one.
- **Released keys do not count as live**: the ranking filters `released` entries, so the
  next-newest registered block takes the freed slot and `liveCount()` excludes it.
- **512-key cap**: the entry array is kept in `seq` order; a new distinct key pushes the
  entry and front-splices the overflow (the oldest tracked entries) beyond
  `PTAH_UI_TRACKED_KEY_CAP = 512`. The pushed entry has the highest seq, so it is never
  evicted by its own registration; an evicted live entry degrades to a snapshot
  (`register` of it later re-adds it with a fresh seq).

## Verification

- `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/services/ptah-ui-live-window.spec.ts` —
  **6/6 passed**:

  ```text
  PtahUiLiveWindow
    √ keeps liveCount() <= 8 after each of 12 in-order registrations and keeps the 8 newest live
    √ ranks by orderKey, not registration arrival order
    √ does not count a released key toward the live blocks
    √ hands a released live slot to the next-newest block
    √ keeps a released key's position when re-registered (remount case)
    √ caps tracked keys at 512 and evicts the oldest entry when exceeded
  Tests: 6 passed, 6 total — exit code 0
  ```

  Covers every named case: 12 in-order registrations with `liveCount() <= 8` asserted
  after each (8 newest live, 4 oldest snapshots); shuffled arrival order with the same
  final live set; release no-op/released-not-counted; release promotes the next-newest
  block; destroy/recreate of blocks 1, 6 and 12 keeping their positions (block 1 stays a
  snapshot, 6 and 12 stay live); the 512-cap eviction observed through the oldest live
  entry (first-registered, highest orderKey) dropping out and block-504 taking its slot.

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-ui --parallel=1` —
  **both targets successful** (last lines):

  ```text
  NX   Successfully ran targets typecheck, lint for project @ptah-extension/chat-ui
  Command exited with code 0
  ```

  (An unrelated "Nx Cloud organization has been disabled due to exceeding the FREE plan"
  notice printed after the run; the targets themselves passed.)

## Not done / notes

- `PTAH_UI_TRACKED_KEY_CAP` is exported from the service file (so the spec asserts the
  real cap, not a magic number) but deliberately NOT re-exported from the main barrel,
  which only gained `PtahUiLiveWindow` and `PTAH_UI_LIVE_CAP`.
- Block wiring (component 9's block/message-text components, `src/ptah-ui.ts` secondary
  entry, tsconfig path) belongs to other batches; not touched here.
