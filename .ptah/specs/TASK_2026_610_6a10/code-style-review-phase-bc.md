# Code Style Review, Phase B+C — TASK_2026_610_6a10

Score: 6/10. Verdict: REVISE (0 blocking, 4 serious, 4 minor).

Scope: commits `f314a4f8a..HEAD`. I read in full the parser, resolver, pipeline and converter, `ptah-ui-block`, `ptah-ui-message-text`, `ptah-ui-live-window`, `ptah-ui.ts`, `ptah-ui-fence-line.ts`, and the diffs of `execution-node`, `message-bubble` and `chat-transcript`. I did not read the specs, `SKILL.md` or `ptah-ui.md` line by line. I ran `prettier --check` only. No build, no lint.

## Findings

1. SERIOUS: prettier fails on 17 files this phase touched, and their base versions were clean.
   - `ptah-ui-parser.ts:133-147` are one-line functions. `parseCells`, at line 139, is about 900 characters and `parseScalar`, at line 141, is about 700. Lines 65-131 also stack several statements per line, for example `state.index += 1; ... ; return { ok: true };`.
   - Prettier also flags `ptah-ui-resolver.ts`, `ptah-ui-pipeline.ts`, `ptah-ui-fence.ts`, `ptah-ui.types.ts`, `ptah-ui.corpus.ts`, `ptah-ui-block.component.ts`, `ptah-ui-message-text.component.ts`, `chat-transcript.component.ts` and several specs. I confirmed the base `chat-transcript.component.ts` and `surface.index.ts` were clean.
   - Every other file in `mcp-apps-contracts` is formatted. Under the pre-commit hook this either reformats the files on the next commit and creates churn, or the branch's CI format check fails.
   - Fix: run `prettier --write` on the touched files. After that, split `parseCells` into a small cell scanner and unit-test it. It is the escape and `$` state machine, and it is currently unreadable.
2. SERIOUS: `HOST_KIND` is added to `vscode-core`, which you said not to extend.
   - Where: `libs/backend/vscode-core/src/di/tokens.ts:205` and `:290`, and the barrel at `libs/backend/vscode-core/src/index.ts:1`.
   - It has two consumers: the registration at `apps/ptah-electron/src/di/phase-1-infra.ts:92` and `agent-sdk` at `sdk-query-options-builder.ts:957`. `agent-sdk` now imports a "which host am I" fact from the VS Code-named lib.
   - It also leaves `HostKind` as an inline union at `tokens.ts:205`, next to unrelated diagnostics tokens.
   - I found no platform-neutral home for this fact in `platform-core`. It belongs in `platform-core/src/di/tokens.ts` (`PLATFORM_TOKENS`), with `HostKind` exported from there. Move it, or record an explicit exception in the plan.
3. SERIOUS: `chat-transcript.component.ts:646-755` runs side effects inside `computed`.
   - There are now three freezes: `_frozenAnchors`, `_frozenTurnTestsAnchors` and `_frozenPtahUiSnapshots`.
   - `ptahUiSnapshots` also mutates a `Map` cache (`_turnSnapshotEntries`) and a session id (`_turnSnapshotSessionId`), and `buildTurnSnapshot` writes the cache. That is not a pure computed.
   - The existing `_frozenAnchors` pattern is the precedent, but the cache mutation goes further than it. Treat the file as being over the size where this stays legible: it is 1118 lines, with about 200 added.
   - Fix: extract the `assistantRuns`, `changeSetForMessage`, `anchoredChangeSetFor` and `TurnSnapshotEntry` code into `transcript-turn-snapshots.ts`, next to `transcript-turns.ts`. Make it a small class or function that owns the cache. The component's computed then only calls it and keeps the freeze.
   - `assistantRuns` (lines 90-120) is documented as "kept in lockstep" with `groupTurns` in `transcript-turns.ts`. That is duplication that can drift. Make `groupTurns` expose the runs and reuse it.
4. SERIOUS: duplicated source-column definitions in `ptah-ui-converter.ts:104-110`.
   - `sourceColumns()` repeats the `columns` of `PTAH_UI_SOURCES` in `ptah-ui-parser.ts:12-16`. The two will drift as soon as a source gains a column.
   - Fix: have the converter return `PTAH_UI_SOURCES[source].columns` and delete the switch.
5. MINOR: `ptah-ui-resolver.ts:55-75` repeats the `source === null || kind !== 'available'` guard three times, and `rowsSource` (line 117) has a return-type union of four members written inline.
   - Add a `PtahUiSourceState` alias in `ptah-ui.types.ts`.
   - Several lines here are over 200 characters, which prettier will fix.
6. MINOR: `execution-node.component.ts:41-79` puts `PtahUiNodeContext` and `samePtahUiContext` in a 561-line component file, and `message-bubble.component.ts` imports a runtime function from it. Move both into `ptah-ui-fence-line.ts` or a `ptah-ui-node-context.ts`. The fence-line file is the natural home.
7. MINOR: the `ptahUiOrderKey` and `ptahUiSnapshot` inputs are threaded transcript to bubble to node to `ptah-ui-message-text` to `ptah-ui-block` (`chat-transcript.component.html:53-54`, `message-bubble.component.ts:133,147`, `execution-node.component.ts:422`). They arrive as two bubble inputs but combine into one context there. That is acceptable. Consider passing a single `ptahUi` input to the bubble to match the node's shape.
8. MINOR: `ptah-ui-live-window.ts:130,150` copies the whole entries array on each `register`, `release` or `upsert`. That is bounded (512) and not a defect. It runs per block mount, and the cost is real if a tab has many blocks.

## Checks that passed

- Tag lattice: `chat-ui` and `chat` are `scope:webview` and `type:feature`. `declarative-dashboard` is `type:ui`, and `type:feature` may depend on `type:ui` (`eslint.config.mjs:355`). `chat` importing the `chat-ui/ptah-ui` lazy entry is allowed.
- Lazy-entry containment: `index.ts:93` exports only `PtahUiLiveWindow` and `PTAH_UI_LIVE_CAP` from the main barrel. `ptah-ui.ts` states that it must not be re-exported from `index.ts`. `execution-node` uses it only inside `@defer`.
- `tsconfig.base.json` has aliases for `chat-ui/ptah-ui` and `chat-ui/turn-recap`, consistent with `change-set-card`.
- Angular: both ptah-ui components are standalone and OnPush, use `inject()` and signals, and have pure computeds. No method calls appear in their templates. `PtahUiLiveWindow` is provided per transcript, matching the `TranscriptRenderWindow` precedent.
- Wiring: `ptahUiFence` is forwarded exactly alongside `mcpToolProfile` in `chat-session.service.ts`, `chat-slash-command-router.service.ts` and the zod schema. The optional `HOST_KIND` injection at `sdk-query-options-builder.ts:957` follows the nearby optional injections, so the pattern itself is consistent.
- `content-manifest.json` regenerated, with both skill files listed.
- Env branching: it sits at the leaf, in the message-sender flag, the bubble context and the transcript gates, and each is commented.

## Note on the `HOST_KIND` token

It lives inline in `TOKENS`, not in its own module. Once moved to `platform-core` (finding 2), the unit test that stubs `agent-sdk` also no longer needs `vscode-core`.

## Re-review (round 1)

Score: 8/10. Verdict: APPROVED (0 blocking, 0 serious, 3 minor remaining). Scope: `git diff 1c462f2b9` plus `transcript-turn-snapshots.ts` and its spec. I read the new file and the diffs of the touched files in full. I ran `prettier --check` on every touched `.ts` file (clean). I did not run build or lint.

### Status of the previous findings

1. Prettier (SERIOUS): RESOLVED. `prettier --check` passes on all files in the diff, including the new snapshot files. The parser and the other files from my list are not in this diff and the check passes for them, so they were already fixed in the base commit.
2. `HOST_KIND` in vscode-core (SERIOUS): RESOLVED. The token is `PLATFORM_TOKENS.HOST_KIND` (`platform-core/src/di/tokens.ts:51`) and `HostKind` is exported from `platform-core/src/index.ts:12`, defined at `platform.types.ts:148`. Both vscode-core definitions are removed (`vscode-core/src/di/tokens.ts`, `index.ts:1`). `agent-sdk` imports from platform-core (`sdk-query-options-builder.ts:18,958`). Electron registers at `phase-1-infra.ts:92`, with `PLATFORM_TOKENS` already imported at line 19. I found no stale reference to the old token or type.
3. Side effects in `computed` / file size / duplicated run walk (SERIOUS): RESOLVED. The cache and its session id now live in `TranscriptTurnSnapshots` (`transcript-turn-snapshots.ts:164-213`). The component's computed (`chat-transcript.component.ts` `ptahUiSnapshots`) is a gate, a call and a freeze. The duplicated `assistantRuns` is deleted. `groupTurns` exposes `assistants` (`transcript-turns.ts:29,101`), so a run is a turn by construction. The component fell from 1118 to 936 lines. No imports are left unused (`transcriptOrderKey`, `ChangeSetAnchors` and `TurnChangeSet` are still used in the component).
4. Duplicated source columns (SERIOUS): RESOLVED. `sourceColumns` returns `PTAH_UI_SOURCES[source].columns` (`ptah-ui-converter.ts:154`).
5. Repeated resolver guard and inline union (MINOR): NOT RESOLVED. The diff adds `clampHostValue` and `.slice(SURFACE_LIMITS.maxTableRows)` to `ptah-ui-resolver.ts` but leaves the guard and the union as they were. This has no cost beyond what was already noted.
6. `PtahUiNodeContext` in `execution-node.component.ts` (MINOR): NOT RESOLVED. It is still at `execution-node.component.ts:51,67`, and `message-bubble.component.ts` still imports it.
7. Two bubble inputs instead of one (MINOR): NOT RESOLVED. This was a suggestion, and it stays one.
8. Whole-array copy in the live window (MINOR): NOT RESOLVED. It is bounded at 512, so it stays an accepted cost.

### New observations from the BF diff (none blocking)

- MINOR: `platform.types.ts:133` has an unrelated trailing-comma change (`value: string,`). It is prettier churn in the lines around the new `HostKind` type. It is harmless but outside the fix's scope.
- MINOR: `transcript-turn-snapshots.ts` is 214 lines and still holds three jobs: the window rule (`changeSetForMessage`), the per-turn resolution, and the cache class. They are cohesive, and only `changeSetForMessage` is exported besides the class. This is fine at this size. Split it only if it grows.
- MINOR: `change-set.store.ts` grew by about 117 lines. The `settledThrough` and grace-timer logic (`graces`, `startGrace`, `settle`) is a second concern next to the reconcile logic. It follows the file's existing per-session `timers` and `generations` maps, has a release path in `onDestroy` and in the per-session cleanup, and documents the contract in the class doc comment. I do not ask for an extraction now, but this is the file to split next if a third per-session concern arrives.
- PASS: `TURN_CHANGE_SET_GRACE_MS` is a named, exported constant beside the existing reconcile constants. `SESSION_TURN_FAILED` is added to `handledMessageTypes`, so the handler stays in sync with its switch.
- PASS: Platform-agnostic libs added no vscode-core import. The relocation reduces `agent-sdk`'s use of vscode-core to `Logger` and `TOKENS`.
