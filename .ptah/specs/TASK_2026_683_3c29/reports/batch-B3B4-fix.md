# B3/B4 fix round 1

| Item | Fix | Evidence |
| --- | --- | --- |
| B3-1 | Track a deferred correction invalidated by a later navigation; reconcile it after NavigationCancel or NavigationError when the router is idle and still on a mismatched chat URL. | `chat-tab-route-sync.service.ts:100, 118-135, 293-324`; cancel/error specs `chat-tab-route-sync.service.spec.ts:433-456` |
| B4-1 | Cover the real six-slot cap, retained A→B→A multi-slot switches, read-phase purity, and class/attribute/property cleanup on falling edge and destroy. | `chat-transcript.session-enter.spec.ts:147-191, 218-259` |
| File size | Move render scheduling, D11 viewport projection, slot collection, writes, and cleanup into one per-transcript helper. Component retains the input effect and one helper call. | `transcript-session-entrance.ts:27-128`; `chat-transcript.component.ts:407-418, 1065-1068, 1346` |
| B4-2/3/4 | Use the existing pure selector for one visibility walk, ignore zero-height slots, and limit lazy rect reads to 24 even when every slot is below the viewport. | `transcript-session-entrance.ts:6, 75-97`; `transcript-entrance.ts:10`; `transcript-entrance.spec.ts:34-37`; `chat-transcript.session-enter.spec.ts:192-209` |

`chat-transcript.component.ts`: 1,491 lines before this fix; 1,396 after (main: 1,398).

## Verification

- Route sync Jest: 1 suite, 34/34 tests passed.
- Transcript Jest: 19 suites, 234/234 tests passed after the lazy-walk change. The first run also passed at 233/233 before the bounded-read spec was added.
- Scoped `ptah_get_diagnostics`: no errors in edited files. It reports 266 errors in sibling files outside this lane's ownership.

## Decisions

- **Cancelled/error navigation recovery:** use the router's terminal event plus a microtask, and let the deferred callback retry if it sees the drop after the router becomes idle. Alternatives were an extra subscription or a timer. The router clears `currentNavigation` after its terminal event; this uses the existing subscription and has no persistent work. Reversible.
- **Entrance extraction:** use one plain helper per transcript with read-only source callbacks. Alternatives were another injectable store or retaining the logic in the component. The plan assigns one transcript consumer and requires one edge-triggered pass; the helper keeps Angular render scheduling close to its marks without introducing a provider. Reversible.
- **Rect read bound:** cap at 24 newest slots. Alternatives were an unbounded skip or an additional scroll observer. The selector still stops at six visible items or the first fully above item, while 24 bounds the exceptional all-below case. Reversible.

## Left open

- B3-2/3 test refinements for the already guarded URL-match and pending-surface cases. They are minor coverage improvements beyond the cancel/error regression.
- B3-4 tracker timeout: the approved plan treats an unsettled transition as outside this batch's required behavior, and the tracker is outside this lane's file ownership.
- B4-5 same-tick true→false→true edge coalescing: the review calls it harmless and defers any change until B5 behavior requires it.
