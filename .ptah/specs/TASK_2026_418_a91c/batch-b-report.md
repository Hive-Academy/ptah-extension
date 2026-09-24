# Batch B report - TASK_2026_418_a91c

Frontend implementation and the approved Revision 1 fixture migration are complete. The exact fresh six-project verification passed all 17 configured targets. The original five failing assertions and scope clarification are resolved. See Revision 1 for current results; earlier failures below are historical.

## Contract and behavior

- Accounting remains the TASK_2026_533 backend snapshot: no changes to the validator, revision floor, snapshot installation rules, or snapshot-only early return.
- The live context shape carries optional `contextKnown` and `contextCapacity`. The numerator comes only from a finite nonnegative latest main-request frame or the separate history context snapshot. Zero is a valid observed numerator; missing/invalid values are explicitly unknown.
- Capacity requires matching exact-model evidence: native SDK evidence or a provider catalog with a provider identity. Legacy numeric windows, unknown evidence, and mismatched models cannot supply a denominator. Native evidence permits the shipped contract's nullable provider identity.
- Explicit unknown objects replace old tab/surface context. No update remains distinct from unknown. Existing surface assignment already has this behavior and its production file is unchanged.
- The summary labels the badge and tooltip "Main context". Unknown numerator or capacity renders an em dash, omits used-token text, progress and warnings, and keeps all accounting chips and rows on `snapshot`.
- Post-compaction seeding keeps valid post-token behavior and retains only matching verified capacity. Nonpositive/missing/invalid post values still clear the seed. Resume no longer guesses a window from a model name.
- Boundary identity and the original measurement envelope flow through accumulator, handler, ChatStore, lifecycle, conversation record, persistence, and template. A complete finite nonnegative same-boundary decreasing envelope is required for "shrank". Legacy, mismatched, malformed, equal, and increasing pairs remain neutral without a reduction arrow.
- New boundaries atomically replace the measurement and endpoints. Same-boundary summary-only duplicates can retain the pair. A new compaction start invalidates the earlier pair so a new summary-only completion cannot inherit it. Summary rendering retains the existing MarkdownBlock safety boundary.

## Files changed (worktree-relative)

### chat-types
- `libs/frontend/chat-types/src/lib/chat-types.ts`: additive live context metadata.

### chat-state
- `libs/frontend/chat-state/src/lib/tab-state.types.ts`: additive live payload metadata.
- `libs/frontend/chat-state/src/lib/tab-manager.service.ts`: unknown resume state; evidence-based post-compaction capacity, snapshot logic preserved.
- `libs/frontend/chat-state/src/lib/tab-manager.intent-mutators.spec.ts`: unknown resume and same-model capacity/snapshot preservation.
- `libs/frontend/chat-state/src/lib/conversation-registry.service.ts`: atomic boundary measurement validation and persistence.
- `libs/frontend/chat-state/src/lib/conversation-registry.service.spec.ts`: sequential/duplicate boundaries, invalid envelopes, summary-only completion and reload.
- `libs/frontend/chat-state/src/lib/surface-session-stats.registry.spec.ts`: unknown clearing versus no update; snapshot identity preserved.

### chat-streaming
- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts` and `.spec.ts`: forward identity and envelope without reconstruction.
- `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts` and `.spec.ts`: both result contracts and forwarding preserve metadata.

### chat
- `libs/frontend/chat/src/lib/services/chat.store.ts`: forward metadata to lifecycle.
- `libs/frontend/chat/src/lib/services/chat-store/session-live-stats.util.ts` and `.spec.ts`: eliminate cumulative numerator fallback and validate capacity.
- `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts` and `.spec.ts`: install explicit unknown context on tabs and surfaces without touching accounting.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` and `.spec.ts`: history uses the shared live derivation; preserve targeted post-compaction seeds.
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts` and `.spec.ts`: forward envelope on normal and late-boundary paths; reload/timers/accounting retained.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`: bind boundary identity and envelope.

### chat-ui
- `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts` and `.spec.ts`: main-context wording and evidence-based unknown presentation in both layouts.
- `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts` and `.spec.ts`: reduction wording only for an attributable decreasing pair.

## Failing specifications first

All required failing specs and extension specs were written and run against unchanged production source. Only the 11 Batch B spec files were selected with `--testPathPatterns` in the four owning projects (`--parallel=2`). Red log: `%TEMP%/task418-b-red.log`, exit 1. Assertion lines below are pre-format locations.

| File / test | Pre-fix evidence | Post-fix evidence |
| --- | --- | --- |
| session-live-stats.util.spec.ts - never substitutes cumulative usage for a missing main context frame | :40:72 - cumulative 108 emitted without `contextKnown: false` | PASS in focused run |
| session-stats-summary.component.spec.ts - renders unknown main context as an em dash without changing tree totals (3 cases) | :140:41 - displayed `25%` for missing numerator/evidence or unknown capacity | PASS in focused run |
| conversation-registry.service.spec.ts - does not carry a measurement across compaction boundaries | :27:59 - boundary A measurement was undefined | PASS in focused run; checks B never inherits A's pre endpoint/envelope |
| compaction-marker.component.spec.ts - does not say shrank for legacy or mixed-source decreasing values | :67:51 - legacy scalar decrease rendered `shrank` | PASS in focused run |
| accumulator-core.service.spec.ts - forwards the compact-boundary measurement unchanged | :858:32 - measurement undefined | PASS in focused run |
| streaming-handler.service.spec.ts - forwards the compact-boundary measurement unchanged | :413:33 - measurement undefined | PASS in focused run |
| tab-manager.intent-mutators.spec.ts - retains only verified same-model capacity after compaction and never changes the snapshot | :740:67 - evidence and known flag dropped from seed | PASS in focused run |
| tab-manager.intent-mutators.spec.ts - unknown resume badge (updated N6) | :1045:50 - expected unknown 0 projection, got guessed 1000000 | PASS in focused run |
| session-stats-aggregator.service.spec.ts - clears known fill for an unknown provider on tabs and surfaces without replacing accounting | :111:35 - next payload lacked unknown state and retained positive window | PASS in focused run |
| session-loader.service.spec.ts - leaves resume capacity unknown without provider evidence | :784:33 - got model-lookup 1000000 and 1% | PASS in focused run |
| compaction-lifecycle.service.spec.ts - forwards the compact-boundary measurement unchanged to the conversation marker | :861:43 - marker writer received only null scalar fields | PASS in focused run |
| surface-session-stats.registry.spec.ts - explicit unknown clears prior fill and retains snapshot | Already passed before implementation; production assignment needed no edit | PASS in focused run |

Windows PowerShell's Python stdin conversion initially substituted `?` for the new literal em dash/arrow assertions. These were changed to explicit Unicode escapes. The red summary still failed on the substantive incorrect `25%`, and the red marker failed on `shrank`; neither failure is claimed to prove correct Unicode rendering by itself. The post-fix Angular tests assert the actual em dash/arrow.

The first post-fix focused run passed the mandatory regression cases. Three old in-scope assertions still expected guessed capacity or no model badge; those expectations were updated before full verification. Additional cases cover invalid numerators, invalid/mismatched capacity, invalid provenance, duplicates, legacy persistence and new summary-only compactions. Focused log: `%TEMP%/task418-b-focused.log`.

## Stack and design evidence

- Angular 22.1.7: root `package.json:93`. Existing standalone/OnPush components use signals, computed values and input signals. Existing registry and loader patterns use root injection.
- Existing summary and marker components are the visual reference. No new component, design token, CSS system or dependency was introduced. Tailwind/daisyui classes and existing interactions are retained.
- Public aliases only; shared types are the frontend/backend bridge. Root `eslint.config.mjs:222` enforces module boundaries. Existing chat-ui core/markdown imports were retained; no chat/state/backend import was added there.
- UI verification uses rendered Angular component fixtures in both summary layouts and the marker's existing summary interaction. No browser screenshot or application launch was performed.
- No accounting loading/empty/error behavior changed; missing context is the explicitly covered unavailable state.

## Verification

Required command, launched once:

```text
npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat-types,@ptah-extension/chat-state,@ptah-extension/chat-streaming,@ptah-extension/chat,@ptah-extension/chat-ui,@ptah-extension/harness-builder --parallel=2 --output-style=static
```

`NX_DAEMON=false`, `NX_ISOLATE_PLUGINS=false`, and `NX_TUI=false` keep this worktree's Nx invocation consistent with Batch A's documented worker workaround and capture static output. Logs: `%TEMP%/task418-b-verify.log` and `task418-b-verify.exit`.

Full-command exit code: 1. No test timed out, so no untouched timeout retry was applicable.

| Project | test | typecheck | lint |
| --- | --- | --- | --- |
| @ptah-extension/chat-types | No test target declared | PASS | PASS |
| @ptah-extension/chat-state | 18 suites passed, 1 failed; 431 passed, 4 failed | PASS | PASS, 0 errors / 2 warnings |
| @ptah-extension/chat-streaming | 24 suites passed; 510 passed, 1 skipped | PASS | PASS, 0 errors / 2 warnings |
| @ptah-extension/chat | 96 suites passed; 1515 passed, 2 skipped | PASS | PASS, 0 errors / 14 warnings |
| @ptah-extension/chat-ui | 34 suites passed; 279 passed | PASS | PASS, 0 errors / 8 warnings |
| @ptah-extension/harness-builder | 4 suites passed, 1 failed; 119 passed, 1 failed | PASS | PASS, 0 errors / 75 warnings |

Unchanged failing files (not unrelated baseline failures: their expectations must be migrated to this batch's deliberate new contract):

1. `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`:
   - :211 - seeds post-compaction context only for a tab with a known model: expects bare legacy 200000 capacity and no additive evidence state.
   - :260 - retains the prior finite positive context window for an unrecognized model: expects bare legacy 200000 capacity.
   - :282 - does not seed context when neither the prior window nor the model registry provides one: expects null, while the required unknown-capacity badge retains the measured numerator/model.
   - :387 - seeds verified late boundary context without resetting messages or compaction count: fixture has no capacity evidence but expects 200000 / 0.8%.
2. `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts:367` - binds stored snapshot and independent live context badge: fixture has no `contextCapacity`, expected `20%`, correctly received em dash.

Neither file belongs to the explicit Batch B ownership list; neither was edited or rerun to repeat the same failure. Required intended behavior was not weakened to satisfy legacy fixtures.

Angular emitted existing NG8107 optional-chain warnings in `mcp-directory-browser.component.ts:175` and `peer-session-send-dialog.component.ts:181`. Nx Cloud reported its organization is disabled for exceeding the free plan (401), so remote artifact storage was unavailable. Local target results above remain visible in the captured log.

After the full command was launched, a final provenance review identified an unidentified summary-only completion with no start event as another way to keep a previous pair. The summary writer now requires an explicit matching boundary; lifecycle supplies it only for its already-authoritatively-completed generation. This is a small in-list correction, with a dedicated regression. The two affected spec files and those two projects' typecheck/lint targets are being checked narrowly; the six-project command was not repeated. Final follow-up evidence: both commands passed (exit codes `0,0`). The selected conversation-registry and compaction-lifecycle spec files pass, and chat-state/chat typecheck and lint pass again. Logs: `%TEMP%/task418-b-provenance-final.log`, `task418-b-provenance-static.log`, and `task418-b-provenance-final.exit`.

```text
npx nx run-many -t test -p @ptah-extension/chat-state,@ptah-extension/chat --parallel=2 --output-style=static --testPathPatterns='conversation-registry.service.spec.ts|compaction-lifecycle.service.spec.ts'
npx nx run-many -t typecheck,lint -p @ptah-extension/chat-state,@ptah-extension/chat --parallel=2 --output-style=static
```

All changed Batch B spec files passed in full verification or this final focused follow-up. Only the two unchanged out-of-list spec files listed above remain failing. Subsequent edits changed documentation comments only.

Scoped `ptah_get_diagnostics` was called for changed production files across all five affected source projects. It returned unavailable after 45 seconds, with the compiler still running; not counted as a pass. Formatting was applied only to Batch B listed files.

## Out-of-list changes

None. The required report is the only task-folder edit. No shared/backend files or TASK_2026_533 validator/revision-floor file were changed. No git mutation, staging, branch, commit, stash, push or history-changing command was run. The requested read-only `git show 5b04570cf --stat` was used to inspect Batch A.

## Open issues at initial delivery (resolved by Revision 1)

1. The five failing legacy-fixture assertions above block acceptance. Updating them requires ownership of two files outside Batch B.
2. The requested scope otherwise implements the context/provenance contract and preserves the accounting snapshot path. No runtime provider calls or private fixtures were used.

## Clarifications Needed - resolved

The orchestrator approved option 1: Batch B now owns the two additional spec files. Revision 1 updates their evidence fixtures and expectations. No further clarification is needed.

## Revision 1

The scope expansion authorizes spec changes only in:

- `libs/frontend/chat-state/src/lib/tab-manager.service.spec.ts`
- `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts`

No production file changed in this revision, no tests were deleted, and every existing snapshot, isolation, message-identity and compaction-count assertion remains intact. Known-capacity fixtures now carry exact-model `provider-catalog` evidence with `tokens: 200000` and the matching provider (`anthropic` or `openai-codex`). This revision uses the existing Batch B contract without weakening it.

### Migrated assertions

Line references identify the migrated tests/assertions in the current revision. Original failing assertion lines were 211, 260, 282, 387 and 367, respectively.

| File / assertion | Old expectation | New expectation and reason |
| --- | --- | --- |
| tab-manager.service.spec.ts:197 - post-compaction known-model seed | Bare numeric window 200000 implies known 0.6% | Fixture supplies matching Anthropic provider capacity; expected seed retains evidence and `contextKnown: true`, 1200 used / 200000 and 0.6%. The percentage now has an authoritative denominator. |
| tab-manager.service.spec.ts:251 - unrecognized-model capacity retention | Bare legacy Codex window 200000 survives as authoritative | Fixture supplies exact `openai-codex` / `gpt-5.6-sol` catalog evidence; seed retains that evidence and 0.6%. Unknown catalog labels do not invalidate genuine provider evidence. |
| tab-manager.service.spec.ts:286 - legacy metadata with unknown capacity | Valid postTokens 1200 produces null live state when no window is known | Assert the model and measured 1200 numerator survive with `contextKnown: true`, no capacity evidence, and zero compatibility projections for window/percent. The UI treats that zero window as unknown, never a displayed percentage. |
| tab-manager.service.spec.ts:395 - late boundary seed | Bare window establishes 1600 / 200000 = 0.8% | Supply matching provider evidence, assert it is retained with the known numerator; keep messages reference and compaction-count assertions unchanged. |
| harness-builder-view.component.spec.ts:374 - independent context badge (legacy case at :382) | Fixture without evidence renders 20% | Add matching Anthropic capacity so the existing 20% assertion is valid. Then remove only capacity evidence and assert em dash, no progress bar, identical snapshot/live binding and unchanged cost/token/agent chips. |

### Verification

Ran the exact requested command once, with fresh execution:

```text
npx nx run-many -t test,typecheck,lint -p @ptah-extension/chat-types,@ptah-extension/chat-state,@ptah-extension/chat-streaming,@ptah-extension/chat,@ptah-extension/chat-ui,@ptah-extension/harness-builder --skip-nx-cache --parallel=2
```

Existing process settings `NX_DAEMON=false`, `NX_ISOLATE_PLUGINS=false`, `NX_TUI=false` were retained. Output is captured in `%TEMP%/task418-b-r1-verify.log`; exit status is in `%TEMP%/task418-b-r1-verify.exit`.

**PASS, exit 0.** Nx reported: "Successfully ran targets test, typecheck, lint for 6 projects". All 17 configured targets passed with cache skipped. Duration: 2m 31s.

| Project | test | typecheck | lint |
| --- | --- | --- | --- |
| @ptah-extension/chat-types | Not configured | PASS | PASS |
| @ptah-extension/chat-state | PASS | PASS | PASS |
| @ptah-extension/chat-streaming | PASS | PASS | PASS |
| @ptah-extension/chat | PASS | PASS | PASS |
| @ptah-extension/chat-ui | PASS | PASS | PASS |
| @ptah-extension/harness-builder | PASS | PASS | PASS |

Nx suppressed the individual logs for all 17 successful tasks; this revision does not invent test or warning counts or rerun successful suites to retrieve them. All five migrated assertions pass as part of their full project test targets. No timeout or retry occurred.

Scoped `ptah_get_diagnostics` reported 32 spec diagnostics in other files and none in either edited spec. Examples include branded session/tab IDs in chat-state specs, setup-hub spec typing, and missing fields in harness-builder-state fixtures. These are outside the two-file revision scope and are distinct from the passing configured Nx typecheck targets. The diagnostics result was read from its cache to filter the two edited paths; no extra test command was run.

### Revision outcome

- All five legacy assertions migrated, preserving the existing non-capacity checks.
- Harness rendering covers both verified 20% context and legacy unknown context, including absence of progress and unchanged accounting.
- Original Clarifications Needed and fixture blockers resolved by the orchestrator's scope approval and this passing verification.
- Only the two newly authorized spec files and this report were written in Revision 1. No production code or git operation was touched.
- No remaining Revision 1 implementation or required-verification blocker. The unrelated spec diagnostics are documented above.
