# Test Report - TASK_2026_692_f748

## Scope

- User request: QA for idle compaction of Claude Agent SDK sessions (all batches committed, diff `7bdc6eed4..HEAD`).
- Criteria tested: every AC of task-description.md reqs 1-7, mapped below. Decisions row 17 applies (no live run).
- Tests added: none. No production code changed. Nothing committed.
- Deliberately not tested: A1 (anchor skew, live check, listed for the PR) and a live 1-hour idle run.

## Execution (one project at a time, `NX_NO_CLOUD=true`, `--parallel=1 --coverage=false`)

Command: `npx nx test @ptah-extension/<p> --parallel=1 --coverage=false`

| Project | Suites | Tests | Result |
| --- | --- | --- | --- |
| shared | 115/115 | 3622 passed | PASS |
| platform-core | 46/47 | 1101 passed, 1 failed, 4 todo | 1 FAIL (pre-existing flake, below) |
| agent-sdk | 170/171 (+2 skipped) | 3621 passed, 1 failed, 3 skipped | 1 FAIL (pre-existing flake, below) |
| rpc-handlers | 163/163 | 4599 passed, 7 skipped | PASS |
| chat-state | 33/33 | 619 passed | PASS |
| chat-ui | 74/74 | 1445 passed | PASS |
| chat-streaming | 26/26 | 634 passed, 1 skipped | PASS |
| chat | 231/231 | 4260 passed, 2 skipped | PASS |

Host smoke specs (`npx jest -c <app jest config> apps/<app>/src/di/container.smoke.spec.ts --coverage=false --maxWorkers=2`):
ptah-cli 18/18 pass, ptah-electron 28/28 pass, ptah-extension-vscode 43/43 pass.

## Failures: new vs pre-existing

Both failures are PRE-EXISTING / load-sensitive, not caused by this branch:

1. `platform-core/src/file-settings-manager.bench.spec.ts` ("keeps per-write cost flat across 1000 sequential set() calls", a timing benchmark, 42 s under load). Evidence: the file and the file-settings manager are not in the branch diff (`git diff --name-only 7bdc6eed4..HEAD` has no match; the diff touches only `file-settings-keys.ts` and its spec). Re-run alone with Jest `--maxWorkers=2`: 2/2 pass.
2. `agent-sdk/.../compaction/subagent-handoff-index.spec.ts` ("forgets a resolved name when it disappears from a rescan", file-system timing). Neither spec nor source is in the diff. Re-run alone: 22/22 pass.

The Jest "worker failed to exit gracefully" warning appears in every project; decisions row 11 records it as not from idle code (`--detectOpenHandles` clean).

## AC coverage map

Paths are relative to `libs/backend/agent-sdk/src/lib/helpers/compaction/idle/` ("idle/") unless stated. Line numbers are the `it(` lines.

| AC | Evidence |
| --- | --- |
| 1.1 arm at anchor+0.9*TTL, 1h only, read-only after earlier 1h write no arm | idle/idle-session.reducer.spec.ts:90; idle-request-tracker.spec.ts:28 (classifyCacheTtl), :65 (last request wins over earlier 1h write) |
| 1.2 anchor at send, not receipt | idle-request-tracker.spec.ts:47 |
| 1.3 one pending attempt per session | idle-session.reducer.spec.ts:90, :191; idle-compaction.service.spec.ts:360 |
| 1.4 not-1h / failed read / no counts / past fire time: no arm | idle-session.reducer.spec.ts:141, :153; idle-request-tracker.spec.ts:28; session-query-executor.idle-signals.spec.ts (`forwards ... null context when the read has no value`) |
| 1.5 stale turn-end read, interleaved sessions | idle-session.reducer.spec.ts:153 |
| 2.1 one `/compact` on live stream, require-idle, no relaunch | idle-compaction.service.spec.ts:159; session-lifecycle/session-stream-pump.service.spec.ts (`runs the claim check immediately before enqueue`) |
| 2.2 refused admission: `not-idle-at-send` | idle-compaction.service.spec.ts:179 |
| 2.3 non-human origin | idle-compaction.service.spec.ts:159 (origin asserted with the send); stream-pump spec |
| 2.4 identity and claim at enqueue, one match | idle-compaction.service.spec.ts:159; idle-session.reducer.spec.ts:191, :286; coalesce.spec.ts:165; compaction-coordinator.spec.ts claim cases |
| 2.5 manual coalesced while claim held | compaction-coordinator.spec.ts:309, :324; coalesce.spec.ts:146; rpc-handlers chat-slash-command-router.idle-coalesce.spec.ts (`coalesces a held idle claim ...`, `... taken during provider resolution`) |
| 2.6 release set and `claim-timeout` WARN | idle-compaction.service.spec.ts:218; coalesce.spec.ts:272; idle-session.reducer.spec.ts:376; compaction-coordinator.spec.ts:336 |
| 2.7 required race test (both cases), exactly one send/compaction/notice, manual after release admitted | coalesce.spec.ts:129 (manual before enqueue wins), :146, :165 (through boundary/result/PostCompact); idle-session.reducer.spec.ts:399, :447; router idle-coalesce spec (`sends after PreCompact, PostCompact ...`) |
| 2.8 no re-arm after matched completion | idle-session.reducer.spec.ts:286, :447 |
| 2.9 send failure / BACKOFF: WARN, no retry | idle-compaction.service.spec.ts:233, :379, :480; idle-session.reducer.spec.ts:215 |
| 3.1 settings off / compaction.enabled off | idle-fire-gate.spec.ts:48 |
| 3.2 not-1h | idle-fire-gate.spec.ts:62 |
| 3.3 lapsed / >60 s late (sleep-wake) | idle-fire-gate.spec.ts:73; idle-compaction.service.spec.ts:284 |
| 3.4 below minimum / no own reading | idle-fire-gate.spec.ts:82 |
| 3.5 activity after arm | idle-fire-gate.spec.ts:88 |
| 3.6 prompt prefix change | idle-fire-gate.spec.ts:92; session-lifecycle-manager.idle.spec.ts:131 (model change forwarded) |
| 3.7 open coordinator state, Codex proxy (amended: OBSERVE_ONLY allowed, decisions row 9) | idle-fire-gate.spec.ts:96; compaction-coordinator.spec.ts claim cases (OBSERVE_ONLY) |
| 3.8 rate-limit warning/rejected | idle-fire-gate.spec.ts:110; session-query-executor.idle-signals.spec.ts (`forwards rate limits`) |
| 3.9 not idle / background subagent | idle-fire-gate.spec.ts:116 |
| 4.1 message / new turn cancels | idle-session.reducer.spec.ts:168; session-lifecycle-manager.idle.spec.ts:131 |
| 4.2 PreCompact cancels | idle-session.reducer.spec.ts:168 |
| 4.3 session end / abort / dispose | idle-compaction.service.spec.ts:341; session-query-executor.idle-signals.spec.ts:191 (query end releases bound ids), :256 |
| 4.4 eviction | Indirect only (see Notes). |
| 4.5 setting off cancels all | idle-compaction.service.spec.ts (enabled toggle harness, :130 helper) and idle-session.reducer.spec.ts:168 (disable) |
| 4.6 dispose cancels all, later calls no-ops | idle-compaction.service.spec.ts:360; coalesce.spec.ts:431 (1,000 sessions, zero timers/entries); session-lifecycle-manager.idle.spec.ts:152 |
| 4.7 rekey keeps one attempt | idle-compaction.service.spec.ts:360; coalesce.spec.ts:467; compaction-hook-handler.spec.ts:1139; compaction-coordinator.spec.ts:336 |
| 5.1 settings in group, defaults | shared advanced-settings.types.spec.ts:89, :110 (bounds 100,000-5,000,000, integer) and `describes the 29 surfaced keys`; platform-core file-settings-keys.spec.ts:280 |
| 5.2 UI rejects below minimum / non-integer | shared advanced-settings.types.spec.ts:110, :158 (generic validator, bounds from the registry entry) |
| 5.3 malformed persisted value: default, WARN once per distinct value | compaction-config-provider.spec.ts `getIdleCompactionConfig` cases (`warns once per distinct bad value`, `uses validated constructor defaults ...`) |
| 5.4 live change, no restart | compaction-config-provider.spec.ts (`reads valid settings on every call`); idle-compaction.service.spec.ts enabled/minimum toggles |
| 5.5 export/import | agent-sdk types/settings-export.types.spec.ts (`exports both idle compaction settings`) |
| 6.1 notice text and token count | agent-sdk system-message.transformer.spec.ts (`stamps a matched idle notice ...`); chat-ui compaction-marker.component.spec.ts (`renders the idle notice with formatted tokens`, `... idle sentence and token reduction together`); chat-state conversation-registry.service.spec.ts (`persists an idle notice ...`) |
| 6.2 not labelled manual | compaction-marker.component.spec.ts (`... no manual wording`); transformer spec (`does not stamp a later manual boundary ...`) |
| 6.3 skipped/cancelled: no notice | transformer spec (`omits the idle field ...` x2); coalesce.spec.ts:129 (no notice) |
| 6.4 other compactions unchanged, coalesced manual adds no notice | transformer spec (manual boundary case); conversation-registry spec (`clears an idle notice when a later compaction starts and fails`); coalesce.spec.ts:146 (one boundary notice) |
| 7.1 rxjs 7.8.2 in both package.json | `libs/backend/agent-sdk/package.json:19`, `apps/ptah-cli/package.json:84` (diff of both +1 line); ptah-cli, Electron and VS Code smoke specs pass; unref-scheduler.spec.ts exercises the real RxJS timer |
| NFR 1,000 sessions, no timers/entries | coalesce.spec.ts:431 |
| NFR unref'd timers | idle/unref-scheduler.spec.ts:12, :38, :49 |
| NFR DI / optional resolve | agent-sdk di/register.compaction-boundary-registry.smoke.spec.ts (`caches construction failure and lets both consumers resolve`); host smoke specs |
| A5 (webview settles after coalesced `chat:continue`) | router idle-coalesce spec and chat message-sender.service.spec.ts (`leaves a settled continue idle without starting a stream`, `starts streaming for a normal successful continue`) |
| A1 anchor skew | OPEN live check, not run (decisions row 17). Unit level pins the anchor rule (AC 1.2). |

No AC is UNCOVERED, so no tests were added.

## Notes / risks

- AC 4.4 (eviction): the code has no direct eviction hook into the idle service. Release is signalled from the query executor when a query ends (`session-query-executor.service.ts:413`, pinned by idle-signals spec :191). Per task-description, a session with a live query is never evicted, and an evicted record has no live query, so a pending attempt cannot outlive eviction. Covered by reasoning plus the query-end release test, not by a dedicated eviction test.
- AC 5.2 is proven at the settings-registry validator level (bounds and `integer` flag), not through the rendered settings UI.
- Two timing-sensitive specs outside this feature flake under a full-project run (above). Neither is related.

## Verdict

PASS. All 8 changed libs and the 3 host smoke specs are green apart from two pre-existing, load-sensitive failures that are outside the diff and pass in isolation. All ACs map to specs. A1 remains an open live check for the PR description.
