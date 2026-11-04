# Field log analysis: idle compaction

## Summary

Across 24 high-context gaps of at least 54 minutes, seven sent idle `/compact`; 17 did not. Fifteen misses had an explicit session end before fire, releasing the attempt. Two reached fire time and logged `background-subagent` vetoes. None of the seven successes logged a session resume/load during its 54-minute window. The logs do not identify the shown tab; the live 60-second test did fire for a background tab and workspace [live-evidence.md, Results].

Log references: **L2** = `C:\Users\abdal\AppData\Roaming\Ptah\logs\Ptah Electron-2026-11-02.log`; **L3** = the corresponding `2026-11-03.log`. Times UTC. Context is stats `lastTurnContextTokens`, a logged proxy, not a direct `getContextUsage` reading. The packaged build lacks armed/firing/released logs [live-evidence.md, Field logs].

## Candidate windows

| Session | Turn end | Context tokens | Idle compact | Events in window | Probable reason |
| --- | --- | ---: | --- | --- | --- |
| 65f2d2a5 | Nov 1 22:36:52 L2:708 | 334,550 | No | Interrupt/end L2:769-775 | Released |
| 27a34c60 | Nov 2 00:17:40 L2:3880 | 329,080 | No | Resume L2:4168; `/session-handoff` query/end L2:4175-4184; abort L2:4247-4269 | New query and release |
| d33c162e | Nov 2 01:44:40 L2:5688 | 213,498 | Yes L2:6184 | None for session | Fired |
| 52a67f07 | Nov 2 02:14:22 L2:6057 | 210,978 | Yes L2:6275 | None | Fired |
| 259e7d99 | Nov 2 04:12:39 L2:6864 | 268,875 | No | End L2:6960-6966; workspace switches L2:8163-9136 | Released before switch |
| d33c162e | Nov 2 06:17:13 L2:10735 | 255,441 | No | End L2:10746-10752 | Released |
| 36f1b8b7 | Nov 2 09:41:44 L2:14287 | 267,416 | Yes L2:14681 | None | Fired |
| 0e737db7 | Nov 2 10:46:15 L2:14738 | 424,622 | Yes L2:15284 | None | Fired |
| a1bd18b1 | Nov 2 16:10:16 L2:16826 | 246,193 | Yes L2:17235 | None | Fired |
| 403bac2d | Nov 2 19:23:28 L2:20392 | 282,745 | No | End L2:20544-20550 | Released |
| bc427320 | Nov 2 20:37:46 L2:26535 | 285,578 | No | End L2:26569-26575 | Released |
| 68b02673 | Nov 2 20:39:24 L2:26725 | 215,015 | No | End L2:31554-31561 | Released |
| 461a7bfd | Nov 2 23:18:53 L3:1291 | 277,542 | No | End L3:1360-1366 | Released |
| 6bda6d5d | Nov 3 00:33:57 L3:2211 | 343,351 | No | End L3:2500-2506 | Released |
| 980d0080 | Nov 3 01:48:00 L3:3585 | 271,249 | No | End L3:4158-4164 | Released |
| 76f5f787 | Nov 3 06:36:53 L3:63086 | 260,000 | Yes L3:74514 | None | Fired |
| ce211063 | Nov 3 11:25:32 L3:120366 | 570,312 | No | End L3:120437-120444 | Released |
| 6d09aa33 | Nov 3 16:21:54 L3:128647 | 217,000 | No | End L3:128832-128838 | Released |
| ba9b1318 | Nov 3 17:29:05 L3:132216 | 201,337 | No | End L3:133245-133251 | Released |
| cb564541 | Nov 3 18:18:34 L3:134806 | 221,233 | No | End and `chat:abort` L3:135066-135073 | Released |
| b2e9d6ea | Nov 3 19:06:34 L3:136965 | 221,044 | No | `background-subagent` L3:139047; tab resolution L3:139163-139165 | Fire-time veto |
| e086004f | Nov 3 19:13:15 L3:137326 | 366,355 | No | End L3:137375-137381 | Released |
| d9414a59 | Nov 3 19:39:03 L3:138301 | 217,893 | No | `background-subagent` L3:139859; tab resolution L3:139861-139864 | Fire-time veto |
| f898c94e | Nov 3 20:00:16 L3:139035 | 208,593 | Yes L3:140388 | None | Fired |

The screen is ≥200,000-token stats followed by ≥54 minutes without another stats record (or log end). A session ending before fire makes the apparent gap non-idle. The two explicit vetoes occurred ~54 minutes after their stats. No SDK registration appeared inside the candidate windows; the workspace switches above occurred after that session ended.

## Compacted sessions

| Session | Turn end | Compact send | Relevant events | Shown evidence |
| --- | --- | --- | --- | --- |
| d33c162e | L2:5688 | L2:6184 (02:38:30) | No session event | Unknown; no view marker |
| 52a67f07 | L2:6057 | L2:6275 (03:08:09) | No session event | Unknown; no view marker |
| 36f1b8b7 | L2:14287 | L2:14681 (10:35:28) | No session event | Unknown; no view marker |
| 0e737db7 | L2:14738 | L2:15284 (11:40:05) | No session event | Unknown; no view marker |
| a1bd18b1 | L2:16826 | L2:17235 (17:04:07) | No session event | Unknown; no view marker |
| 76f5f787 | L3:63086 | L3:74514 (07:30:40) | No session event | Unknown; no view marker |
| f898c94e | L3:139035 | L3:140388 (20:54:06) | No session event | Unknown; no view marker |

Every send has `contentLength:8`, `originKind:"coordinator"`, and occurred about 53m44s–53m51s after logged turn-end stats, consistent with a request anchor preceding turn end. No `chat:resume`, `session:load`, `chat:continue`, or tab resolution for the same session appears within those windows.

## Causes ranked

| Cause | Count | Log evidence | Code path |
| --- | ---: | --- | --- |
| Session end/abort before fire | 15 | End lines for each of the 15 rows above, e.g. L2:769-775, 4178-4184, 6960-6966; L3:135066-135073, 137375-137381. | `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts:423-458` releases idle ownership on stream end/abort; `compaction/idle/idle-session.reducer.ts:407-410` clears attempt. New input/request also clears pending at reducer `:128-136`. |
| SDK background subagent phase at fire | 2 | L3:139047 and L3:139859, each at the expected fire time. | `compaction/idle/idle-fire-gate.ts:55-57` vetoes `awaiting-background`; `idle-compaction.service.ts:388-414` records fire skip. |
| App restart, workspace switch, or shown-tab state | 0 demonstrated | No registration within these windows; `259e7d99` ended L2:6960-6966 before switches L2:8163-9136. | No shown-tab condition in `idle-fire-gate.ts:24-58`. |

## Shown vs background

**No supported shown-only correlation.** The seven successful windows lack session-specific view markers, so their visibility cannot be classified. The two `background-subagent` skips concern the SDK turn phase, not UI background tabs; both sessions have tab-resolution lines after the skip (L3:139163-139165, 139861-139864). The separate live test did fire for background tab and other workspace [live-evidence.md, Results].

## Decisions

- Define a candidate broadly by high `lastTurnContextTokens` and a ≥54-minute gap in stats; retain ended sessions to explain apparent idle gaps. This can be revised if raw request/usage telemetry becomes available.
- Assign causes only from explicit end or transition evidence. DEBUG-only `no-reading`, `not-1h`, and activity reasons cannot be ruled in from this packaged build [live-evidence.md, Field logs].
