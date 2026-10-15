# Batch F1 report

Implemented two pure webview units and their unit specs. No replayer files were edited.

## Public API

- `new PersistedContentFilter(options: PersistedContentFilterOptions)` where options are `tabId`, `sessionId`, `history: ReadonlyMap<string, readonly BlockSignature[]>`, `historyToolResults`, `historyToolIds`, `prefixMark`, `seedMessageIds`, `seedStartK`, `seedBlockKeys`, `deliverToTab(event)`, and `reconcileHistoryToolResult(event): boolean`.
- `filter.decide(event: FlatStreamEventUnion, arrival?: number): 'keep' | 'drop' | 'hold'`. `drop` and `hold` apply to this tab only. Earlier held events are emitted through `deliverToTab`.
- `filter.retire(discard = false): void`. The default resolves pending content before removing state; `discard: true` is for a closed or rebound tab.
- `patchHistoryToolResult(messages: readonly ExecutionChatMessage[], event: ToolResultEvent): readonly ExecutionChatMessage[]`. It patches matching finalized tool and Task agent nodes by `toolCallId`, copies changed paths, and returns the original array when no field changes.
- `BlockSignature` is `{ kind: 'text' | 'thinking' | 'tool'; value: string }`; a tool's value is its `toolCallId`.

## Rule evidence

Paths in this table are relative to `libs/frontend/chat/src/lib/services/chat-store/`. Test names are from `persisted-content-filter.spec.ts` unless noted.

| Rule | Code | Test name |
| --- | --- | --- |
| P | `persisted-content-filter.ts:116` | P drops only pre-snapshot seed copies and seed anchors |
| P2 | `persisted-content-filter.ts:269` | P2 drops a pre-snapshot complete batch for an untracked seeded X; P2 keeps an unmatched complete block and flushes the pre-snapshot anchor first |
| P3 | `persisted-content-filter.ts:301` | P3 absorbs a truncated pre-snapshot prefix and P2 discards it on a complete copy; P3 rebuilds a divergent prefix before keeping its next delta |
| T | `persisted-content-filter.ts:161` | T keeps synthetic or changed real results, reconciles history, then drops an exact redelivery; T structurally compares persisted JSON and keeps results for unknown tools; T reconciles a changed persisted result and a history tool with no prior result |
| R | `persisted-content-filter.ts:108`, `:146` | R keeps a terminal and releases an unresolved loose prefix before it |
| O | `persisted-content-filter.ts:113` | O keeps unscoped events and user starts |
| I | `persisted-content-filter.ts:124`, `:181` | I passes through an older-host seed id and a non-anchor first event; I tracks a seeded start at k0 and H drops its exact next block |
| S | `persisted-content-filter.ts:326` | S flushes a pending anchor on beyond-history content and drops a history tool by identity; S releases a loose block on its next stream delta beyond the page |
| H | `persisted-content-filter.ts:344`, `:434` | H absorbs a stream prefix and drops its exact complete batch without a live partial; H releases merged text and the held batch head on a complete mismatch; H fails open immediately on a stream mismatch and warns once; H handles three history records in one complete batch and keeps an uncovered suffix; H keeps subagent thinking outside the compared sequence |
| Loose continuation/discard | `persisted-content-filter.ts:243`, `:259`, `:326`, `:344` | loose blocks continue at ks after a deferred anchor and are discarded by an exact complete copy; loose blocks are discarded by a kept complete copy in passthrough; S releases a loose block on its next stream delta beyond the page |
| Retirement, absorbed discard | `persisted-content-filter.ts:442` | H absorbs a stream prefix and drops its exact complete batch without a live partial |
| Retirement, loose discard | `persisted-content-filter.ts:442` | retirement discards an earlier loose prefix and an exact last loose block |
| Retirement, loose rebuild | `persisted-content-filter.ts:442` | R keeps a terminal and releases an unresolved loose prefix before it; retirement rebuilds an earlier loose block without a pre-snapshot history prefix |
| Malformed queue bound | `persisted-content-filter.ts:199`, `:464` | a malformed queue warns once and fails open |
| Finalized tree patch | `history-tool-result-patch.ts:5`, `:41` | `history-tool-result-patch.spec.ts`: patches a tool two levels down and its Task agent while preserving unrelated identities; returns the identical array when no node matches or the matching nodes already agree; updates output and clears an old permission flag when the real result changes |

## Checks

Each command acquired and released `.check-lock` independently.

| Command | Result | Tail |
| --- | --- | --- |
| `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-store/persisted-content-filter.spec.ts libs/frontend/chat/src/lib/services/chat-store/history-tool-result-patch.spec.ts --coverage=false --maxWorkers=2` | **PASS** | `Test Suites: 2 passed, 2 total`; `Tests: 27 passed, 27 total`; `Time: 4.401 s` |
| `npx nx typecheck @ptah-extension/chat --parallel=1` | **PASS** | `Successfully ran target typecheck for project @ptah-extension/chat`; existing `NG8107` warning in `peer-session-send-dialog.component.ts:181` |
| `npx nx lint @ptah-extension/chat --parallel=1` | **PASS** | `34 problems (0 errors, 34 warnings)`; `Successfully ran target lint for project @ptah-extension/chat` |

The final Nx commands also printed a recoverable Nx Cloud account warning; both local targets exited successfully. Scoped Ptah diagnostics found no errors in the four requested files.

## Decisions

- A signature carries its full string in `value`, including the unique tool id. This makes F2's history index explicit and uses exact equality. Unrecognized or positionless events stay visible.
- A pre-snapshot complete batch head is held until its blocks determine whether the whole batch was dropped. An unmatched block flushes the head before that block is kept; this preserves content and anchor order.
- A pre-snapshot stream event never initializes tracked position state. P3 keeps its text in a loose queue slot until a post-snapshot event establishes `k0`, so a truncated seed cannot cause the prefix to disappear.
- A kept complete text/thinking block discards a covered loose prefix before the passthrough path considers rebuilding that same block. Complete events replace stream text in the accumulator, so rebuilding the prefix would show it twice.
- For a loose block's next stream delta in passthrough, rule S flushes queued non-content events, rebuilds the prefix, then keeps the current delta. This follows S's stated order and preserves every character.
- Retirement treats the latest pre-snapshot stream block more cautiously than earlier blocks: it discards the latest only on exact equality with a pre-snapshot history block; otherwise it rebuilds it before the terminal. This favors a possible duplicate over losing an aborted in-flight prefix.
- `retire(true)` discards state for a tab that no longer exists or no longer owns the session; the default releases it. F2 chooses the branch when it wires tab lifetime.

## Open

- Batch F2 must build `BlockSignature` values in history order and wire the filter, patch helper, and tab lifecycle. F1 is not integrated into the replayer by design.

## Revise round 1

Only `persisted-content-filter.ts` and its spec changed in this revision. Line numbers below are in those files.

| Review defect | Fix | Regression test |
| --- | --- | --- |
| 1: non-history tool absorbed as thinking | `persisted-content-filter.ts:267,391,408` restricts absorption to text/thinking events and mismatches non-history tools in both tracked paths. P3's separate tool branch remains keep. | `R-B3d keeps a non-history tool against thinking and releases the anchor`; `P3 keeps a non-history tool instead of absorbing a thinking prefix` |
| 2: pre-snapshot agent duplication | `persisted-content-filter.ts:319` drops non-block complete events inside an open pre-batch while every block has been dropped. | `P2 drops an agent_start inside an otherwise dropped pre-snapshot batch`; `P2 drops the head and tail of a zero-block pre-snapshot batch` |
| 3: lost real tool result after failed reconciliation or retirement | `persisted-content-filter.ts:107-111,170-188` records only successful reconciliation; normal retirement keeps every result and retries changed history-tool results. `retire(true)` disables reconciliation (`:155`). | `T keeps redeliveries when reconciliation found no history node`; `T reconciles changed history tool results after retirement and always keeps them` |
| 4: throwing delivery redelivers queued content | `persisted-content-filter.ts:229-250,479-489` removes queue entries and released blocks before calling `deliverToTab`. | `delivery failure does not requeue a flushed anchor`; `delivery failure does not requeue a released block or earlier anchor` |

| Missing-test item | Added coverage (`persisted-content-filter.spec.ts`) |
| --- | --- |
| 1 | `:291` non-history tool versus thinking; `:302` P3 tool; `:312` differing tool id |
| 2 | `:312` R-B3d tool and text mismatch variants |
| 3 | `:325` tracked beyond-page anchor; `:334` loose block rebuild |
| 4 | `:346` R-B1s(c) unpersisted prefix and continuation |
| 5 | `:358` R-B1s(a) complete pre-snapshot batch, deferred anchor, later block |
| 6 | `:376` R-B6 thinking-only history followed by kept text and tail |
| 7 | `:388` R-B5 stream subagent text after kept thinking |
| 8 | `:395` R-B3c 2500 deltas, exact and changed complete variants, terminal |
| 9 | `:407` thinking rebuild order and fresh merged delta id |
| 10 | `:426` P3 first thinking start/signature and passed block |
| 11 | `:438` stream and complete tool identity advance positions before text |
| 12 | `:451` pre-snapshot agent_start; `:461` zero-block batch |
| 13 | `:469` queued delta after kept content; `:479` loose releases precede terminal; existing `:261,271` discard/rebuild branches |
| 14 | `:494` isError-only and JSON inequality; `:509` failed reconciliation; `:518` post-retirement result |
| 15 | `:533,549` throwing flush and release callbacks |
| 16 | Renamed the test at `:204` to describe its actual pass-state path; tracked beyond-page coverage is `:325,334`. |

**API additions:** None. Constructor options, `decide(event, arrival?)`, `retire(discard?)`, and `BlockSignature` retain their signatures. The JSDoc now states the post-retirement tool-result behavior.

**Checks (final revision):**

| Command | Result | Tail |
| --- | --- | --- |
| `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/chat-store/persisted-content-filter.spec.ts libs/frontend/chat/src/lib/services/chat-store/history-tool-result-patch.spec.ts --coverage=false --maxWorkers=2` | **PASS** | `Test Suites: 2 passed, 2 total`; `Tests: 51 passed, 51 total`; `Time: 4.337 s` |
| `npx nx lint @ptah-extension/chat --parallel=1` | **PASS** | `37 problems (0 errors, 37 warnings)`; `Successfully ran target lint for project @ptah-extension/chat` |

The scoped diagnostics tool found no errors in the two edited files. It reported errors in sibling files being edited by other lanes. Typecheck was skipped as instructed because another lane was editing this project.

**Decisions:** After normal retirement, a history-tool result is always kept. A changed or previously unrecorded result is reconciled again, and only a successful reconciliation updates the comparison record. This favors retrying a missing history patch over dropping its only real result. `retire(true)` means the tab no longer owns the session, so it disables this callback. Queue entries are removed before delivery; if delivery throws, the exception still propagates and later queued entries remain available.

**Open:** The broader project typecheck is owned by the orchestrator. No API addition or F2 wiring is needed from this revision.
