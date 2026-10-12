# Code Logic Re-review - Phase A fix commits (46fce6a69, fa90d4920)

Static read only. No tests, typecheck, lint, build or git mutation were run. Verdict: PASS (0 Serious, 3 Moderate new, none blocking).

## Original findings

| Source / finding | Status | Evidence |
| --- | --- | --- |
| B0-B1 #1 Serious: hard deny filed under active tab | FIXED | `permission-handler.service.ts:422-426` passes `tabId`; `:455-468` uses `request.tabId ?? promptTargetTabs[0] ?? decidingTabId ?? activeTabId`. The deciding tab is now the fallback before the active tab. |
| B0-B1 #2 Moderate: decision pulse cannot drive cross-tab cancellation (`_promptTargetTabs` deleted before router reads it) | NOT FIXED (not claimed) | `permission-handler.service.ts:437-440` still deletes the targets right after publishing the pulse. |
| Logic #1 Serious: elapsed freezes with no running lane | FIXED | `compact-session-card.component.ts:286` runs the interval when `streaming() \|\| running > 0`. The clear path is kept (`:293`, `:297-299`, `clearElapsedTimer` `:325`). Still one interval: `elapsedTimer === null` check. |
| Logic #2 Serious: unresolved-parent CLI permission shown on every card | FIXED for the callout only | The card callout now reads `agentsOwnedBySession` (card diff, callout lookup). The lane list still uses the tolerant `agentsForSession` (`sessionAgents`, card `:136`). See N1. |
| Logic #3 Moderate: subagent timings wrong | FIXED (by blanking) | `compact-lane-rows.ts:81-86`: `startedAt: null`, `endedAt` only for terminal mapped status. The lane elapsed now always shows "—" for subagent and background lanes. See N2. |
| Logic #4 Moderate: double click and optimistic clear | PARTIAL | A double answer is blocked by `answeredRequestIds` (`agent-permission-responder.ts:18,26-27`). The clear is still optimistic after a silently dropped host message. |
| Logic #5 Moderate: session respond is a silent no-op | NOT FIXED (accepted) | `card.component.ts:300-306` still drops a click with no feedback when the request is gone. The race is narrow. |
| Logic #6 Moderate: Retry absent | NOT FIXED (accepted) | Fix-2 report says the Retry control is kept as is. |
| Logic #7 Moderate: todos and git missing | NOT FIXED (not claimed) | Still a scope decision for the user. |
| Logic #8, #9 Minor | NOT FIXED | Neither claimed. |
| Style #1 Serious: duplicate elapsed formatter | PARTIAL | The private `formatElapsed` is gone and `formatBoardDuration` wraps the shared `formatDuration` (`lanes.component.ts:51-63`). It was added in the component file, not in `session-stats-format.ts` as recommended. It is imported from the lanes file by the activity component (`activity.component.ts:20`). |
| Style #2 Serious: activity component too large | PARTIAL | About 170 lines moved to `compact-session-lanes.component.ts`. The fix report says the 700-line lint warning is still raised. |
| Style #3 Moderate: `SessionCardActions` interface | FIXED | `session-context.token.ts:47-50`, exported at `chat/src/index.ts:32`. |
| Style #4 Moderate: lane-key contract | FIXED | `LANE_KEY_PREFIX`, `parseLaneKey` at `compact-lane-rows.ts:21-40`, exported from the barrel. The parser rejects an empty id and an unknown prefix. |
| Style #5 Moderate: responder placement | NOT FIXED (not claimed) | |
| Style #6 Minor: deny reason | FIXED | `card.component.ts:310-315` passes `'User denied'` on deny. |
| Style #7 Minor: duplicated agent lookup | FIXED | `sessionAgents` computed (card `:136`). The callout uses `agentsOwnedBySession`, so a second lookup remains by design. |
| Visual G1 "+N more" clipped | FIXED on paper, render unverified | `activity.component.ts:762` `gap-0.5 py-1`; child `py-px` rows; the "+N more" line sits in the child `lanes.component.ts:134-138`. |
| Visual G5 callout height | FIXED on paper | `h-20 shrink-0` on both callouts (`activity.component.ts:774,801`). 80px + summary 16px + padding 8px is under the 120px zone minimum. |
| Visual G6 model shown twice | FIXED | `boardMetrics` sets `model: null` in board mode; the stats row renders nothing for a null model (`stats.component.ts:16`). |
| Visual G7 sub line 10px and row padding | FIXED | `text-[11px]` on `data-zone="sub"`; `py-px` rows. |
| Visual G4 model contrast (board) | FIXED for board | `text-secondary` on the sub line. The non-board stats row keeps `text-purple-400`. Light-theme contrast still unmeasured. |
| Visual G2, G3 | NOT FIXED (not claimed) | |

## Regression check on the extraction

No regression found. `data-zone="lanes"`, `data-testid` `cs-lanes-summary`, `cs-lanes-placeholder`, `cs-lanes-more`, `data-lane-id` and the aria labels all survive in the child. `cs-callout-permission` and `cs-callout-error` are unchanged. The host class `contents` keeps the child's nodes as flex children of the zone. `remainingLanes = moreCount + max(0, rows.length - 3)` equals the old `total - min(rows.length, 3)`. The rows and "+N more" are hidden while a callout shows, as before (`showRows = callout() === null`). `laneSelected` is re-emitted. The responder guard is released if `postMessage` or `clearPermission` throws, so a failed post can be retried.

## New findings

1. **Moderate (N1) - a waiting lane can have no way to answer it.** The callout now requires an exact parent match (`agentsOwnedBySession`), but the lane rows still use the tolerant `agentVisibleInSession`. A CLI agent with an unresolved parent therefore appears on every card as "waiting", because `permissionQueue.length > 0` maps it to waiting (`compact-lane-rows.ts:44-46,66`). No Allow/Deny is offered on any card for it. The wrong-session approval is closed, but the card is now inconsistent. Decide whether lanes should use the strict rule, or record the tolerant rule in decisions.md.
2. **Moderate (N2) - subagent and background elapsed is always "—".** `startedAt: null` means finished subagents never show a duration either (`compact-lane-rows.ts:81`; lanes `elapsedLabel` returns "—"). This is honest, but it drops the prototype's per-lane elapsed for those kinds. If the real start time exists anywhere in the subagent record, wire it. Otherwise record it as a known gap.
3. **Moderate (N3) - the answered guard is not fully safe.** If `clearPermission` throws after a successful post, the id is released (`agent-permission-responder.ts:38-40`) and a retry posts a second host response. The set also grows by one id per answered CLI permission for the life of the root service (small, no eviction).

Minor notes, not counted: `formatBoardDuration` returns "NaNs" for NaN input (`lanes.component.ts:51-63`). The "Lanes" label style is now duplicated inline in the child and as `.cs-zone-label` in the activity component.

## Verdict

PASS. Fix-1 and Fix-2 resolve every Serious finding they claimed. There is no new Serious defect. Open items are N1 to N3, the unclaimed B0-B1 #2 pulse issue, and the unverified 244px render.
