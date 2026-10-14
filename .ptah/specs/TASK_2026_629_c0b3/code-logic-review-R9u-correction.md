# Code Logic Review: R9u post-cap correction (N1, N2, lint guard)

Scope: `rail-transcript-retention-coordinator.service.ts` (whole file), its `.spec.ts` (whole file), `transcript-retention.service.ts` (whole file, for the call sites), `chat-view.component.ts:844-883` (the only consumer of `liveElsewhere`), and the unused-import removal in `chat-view.keepalive.spec.ts`. Reviewed against `code-logic-review-R9u-fix.md` rows N1/N2, `lane-R9u-correction-report.md` and decisions row 101.

Verification run by me: `node .ptah/tmp/check-run.mjs rr2-r9u-1 -- npx nx test @ptah-extension/chat --testFile=rail-transcript-retention-coordinator.service.spec.ts ...` gave `Test Suites: 1 passed`, `Tests: 8 passed, 8 total`. Mutation claims below are by reasoning (I may not edit source).

## Per-finding table

| Finding | Status | Evidence (file:line) | Fails if the fix is removed? |
| --- | --- | --- | --- |
| N1 host registry not reactive, so a late-registered pane leaves A's computed stale | **FIXED** | `active` is now `signal<ReadonlyMap<host, Signal<string\|null>>>` (coordinator:9). `register` and `releaseHost` write a fresh Map (:21-25, :60-62). `liveElsewhere` reads `this.active()` (:29), so any consumer computed depends on registry membership as well as on each other pane's live tab. `chat-view.component.ts:867-870` reads it inside `transcriptTabIds`, so A's list recomputes when B registers or unregisters. | Yes. In spec :86-108, A is the only registered host, so `liveElsewhere(a,'X')` reads no other pane's signal. With a plain Map, `visible` would have no dependency that changes on `register(b)`. It would stay cached, and `expect(visible()).not.toContain('X')` at :98 would fail. The post-`detectChanges` DOM check (:99-100) and the unregister restore (:103-106) also hold. Not vacuous. |
| N2 "count <= 4" and "fifth evicts" were one `it` | **FIXED** | Two separate `it`s with the exact contract names: `count <= 4 counts distinct tab trees` (spec:110) and `fifth distinct tab evicts the LRU frozen tree, never a pinned visible tab` (spec:122). | Both are non-vacuous (see below). |
| Non-null assertion replaced by a typed guard | **FIXED, same behaviour** | `const owner = this.owners.get(victim); if (!owner) return;` (coordinator:75-76). `victim` always comes from iterating `owners`, so the guard is unreachable. Behaviour is unchanged: the previous code would have released `owners.get(victim)`, and the guard only adds a safe exit. | n/a |
| Unused `DisplayDockState` import in `chat-view.keepalive.spec.ts` | **FIXED** | Grep of `chat-view*` finds `DisplayDockState` only in `chat-view.component.ts` and `chat-view.dock.spec.ts`; none in the keepalive spec. | n/a |

### N2 test strength
- `count <= 4` (spec:110-120): A touches A, C, D and B touches B, so the count is 4. `b.touch('C')` transfers C from A to B. The test asserts the count is still 4, that `a.retainedTabIds()` no longer holds C, and that `b.retainedTabIds()` does. A coordinator that counted a transfer as a new tree would give 5 and fail. It is partly weak: a per-host sum would also give 4 here, because transfer leaves no duplicate. The distinct-vs-sum difference is pinned by case 1 (spec:73-84, count 1 for one tab shown in two hosts). Minor, not a defect.
- `fifth distinct` (spec:122-133): A (pinned, oldest at tick 1) and B (pinned) are active. `b.touch('E')` makes five trees. The test asserts the count is 4, that A and B survive, and that C is gone. Without pinning, A would be the LRU victim and `a.retainedTabIds() toContain 'A'` would fail. An MRU victim would take E, and `not.toContain('C')` would fail. Non-vacuous. It does not assert that D and E survive (Minor).

## New defects

| ID | Sev | Location | Finding |
| --- | --- | --- | --- |
| C1 | Minor | coordinator:56-63 | `releaseHost` always writes a fresh Map, even when the host was never registered, or when it is released twice (host destroy followed by coordinator destroy, :16-18). Each such call invalidates every pane's `transcriptTabIds` computed for nothing. This is idempotent and harmless at n <= a few panes. A `has()` check would remove the churn. |
| C2 | Minor (coverage) | spec:86-108 | N1 is tested with a stub `{}` host plus a fixed-signal active tab. That proves the registry reactivity. It does not exercise a real second `TranscriptRetentionService` registering mid-tick, so the "no NG0100/NG0101 when B is created during A's change detection" path rests on reasoning only (below). Two real hosts are covered in cases 1, 3 and 4, but without a rendered view. |
| C3 | Info | n/a | The NG0101 "ApplicationRef.tick is called recursively" console errors in the keepalive run are pre-existing. `code-logic-review-R9u-fix.md:113` attributes them to the 2 older workspace-switch cases, and the R9u review noted them before this correction. Nothing here ties them to this change. |

No Blocking or Serious defects found.

## Checklist from the brief

- **No new reactive cycle.** `liveElsewhere` only reads (`active()` and each other pane's `activeTabId()`). Writes to `active` happen in three places, none inside a computed or effect that reads it:
  - `register`: called from the `TranscriptRetentionService` constructor (service:77-79). The service is created under `getNodeInjectable`, which suspends the reactive consumer, so there is no NG0600.
  - `releaseHost`: called from `onDestroy` (service:81-85, coordinator:16-18).
  - `touch` and `evict`: they read `this.active()` and write `count`. Every call site is already `untracked`, namely the active-tab effect (service:96-99), the tab-closed listener (:108) and the removed-workspace effect (:121).
- **NG0100/NG0101 when B registers during A's view check.** The write marks A's `transcriptTabIds` consumer dirty. Angular's tick loop re-refreshes signal-dirty views before `checkNoChanges`, so this resolves within the tick. I did not exercise it with two real hosts (C2).
- **No leak on unregister.** `releaseHost` releases owned trees, then deletes the host from the registry. The coordinator's `onDestroy` releases every registered host. The retained signal references die with the Map entry.
- **No canvas import, no `HIDE_AGENT_SIDEBAR: true`.** Grep of both retention files finds neither.
- **No-coordinator path unchanged.** `liveElsewhere` returns `false` when `_coordinator` is null (service:63-65). `touch`, `dispose` and `releaseFromCoordinator` still take their local branches (service:131-138, 157-163).

## Five logic questions

1. **Silent failure.** The previously silent stale exclusion is closed: a late-registered pane now invalidates A's list. A stub host leaves `owners` empty, so unregister is clean.
2. **Unexpected user action.** Opening a new Rail pane on a tab frozen in another pane no longer renders two copies of the transcript for a tick. The same tab live in two panes simultaneously is still allowed, and each pane appends its own active tab. This is unchanged and was recorded earlier as a Minor.
3. **Wrong answer on input.** A null active tab never matches a string `tabId`, so `liveElsewhere` is false. An empty registry gives false.
4. **Dependency failure.** The coordinator is destroyed before or after its hosts. `releaseHost` and `release` are both idempotent, and the coordinator's destroy path now writes the `active` signal on a possibly torn-down injector, which is harmless.
5. **Missing though unstated.** A real two-host reactive test (C2), and a dev-mode guard for one tab live in two panes (carried over).

## Verdict

- Score: **8/10**. The fix is correct, minimal and demonstrably non-vacuous. The 2 points withheld are C2 (the new test uses a stub host rather than a real registering pane) and a N2 pair that is correct but lightly asserted.
- Recommendation: **APPROVE**
- Confidence: HIGH on N1/N2/guard (8/8 spec run by me, mutation by reasoning); MEDIUM on the real-pane same-tick registration path (reasoned, not run).
