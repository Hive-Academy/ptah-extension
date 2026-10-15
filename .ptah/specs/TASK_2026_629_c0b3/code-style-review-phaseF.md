# Code Style Review, Phase F (a1114b8df..4208fc840)

Score 7/10. Verdict: REVISE (0 blocking, 3 serious, 4 minor). Scope: diffs of both barrels, session-context.token.ts, session-git-stats.store.ts (read in full), compact-session-metrics.ts, canvas store, running-cap, tile, details, chat-input, card and activity diffs. No tests, lint or nx run (per instruction). Layer direction was checked by reading imports only.

## Serious

1. Tooling-only export in the chat barrel. `libs/frontend/chat/src/index.ts` adds `export { StreamPresentationStore }`. Its only consumer is `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts:55,1192`. No production code outside chat uses it. This widens the public API for a test and invites app code to inject an internal presentation store. Fix: remove the export. In the spec, provide a local stub, or build the fixture through chat's existing test helpers or a deep import allowed only in the spec via a testing entry point.
2. Duplicated root normalization. `session-git-stats.store.ts:24-27` re-implements `normalizeRoot`, which `change-set.store.ts:124-130` already has along with `sameRoot`. The two have already drifted in how they handle drive-letter case and trailing slashes, and the copy's behaviour is not guaranteed to match the original. `sessionWorkingRoot` also duplicates how ChangeSetStore resolves a root. Fix: extract one `normalizeWorkspaceRoot` into a shared chat util (or chat-state), and use it in both stores.
3. Presentational leak and duplicated formatting across libs.
   - The todo/git title and glyph logic is written three times: the inline template expressions in `compact-session-activity.component.ts` (`todo?.kind === 'known' ? ...` and the git title), and `todoTitle()`/`gitTitle()` plus the computed chain in `canvas-session-details.component.ts`.
   - The strings have already diverged. The activity card says "Git changes unknown" for the unavailable case, but `gitTitle` says "No changes", so a non-repo and an unavailable state read differently across surfaces.
   - Fix: export `todoTitle(state)` and `gitTitle(state)` from `compact-session-metrics.ts` (pure, in chat-ui), and use them in both components. This also removes the nested ternaries from the template. The 1290-line activity component then stops growing.

## Minor

- `canvas-session-details.component.ts` calls `this.tabs.findTabByIdAcrossWorkspaces?.(...)`. `TabManagerService.findTabByIdAcrossWorkspaces` is non-optional (`chat-state/.../tab-manager.service.ts:635`). The `?.` only papers over incomplete test mocks, hides real API drift, and sets a precedent for loosening. Fix the mock in the spec instead.
- `SESSION_START_GUARD` (`session-context.token.ts`) is `InjectionToken<() => string | null>` and is provided with an inline `useValue` closure in `canvas-tile.component.ts`. It is consistent with the neighbouring optional tokens (`SESSION_FORCED_CARD`, etc.). Its contract is only a JSDoc line. Add a named type (`SessionStartGuard`) beside `SessionCardActions` so the barrel exports the type too, as it does for `SessionCardActions`. The barrel currently exports the token but no type.
- `showImageAttachmentError` was renamed to `showComposerError` (about 8 call sites) in `chat-input.component.ts`, a 1594-line file. The rename is justified because the guard message is not an image error. But the backing fields still say `_imageAttachmentError*`, so the name is half-migrated. Either rename the fields or leave a note. Adding the guard did not increase the file's responsibility count.
- `console.warn` in `session-git-stats.store.ts` follows `change-set.store.ts:418,431,646`. Precedent is OK. But ChangeSetStore uses a `LOG_PREFIX` constant, while the new store hard-codes `'[SessionGitStatsStore]'` twice. Use a constant.

## Checks that passed

- Dependency direction. chat-ui `compact-session-metrics.ts` imports only `chat-types`, `shared` and a sibling file, so it stays presentational. `CompactGitState` is imported with `import type` into chat. The activity component only receives inputs (`todos`, `gitStats`).
- chat-types `latestTodoWrite` is optional, additive, readonly, and set in the accumulator with an ordering guard. No `as any` was found in the reviewed diffs.
- canvas: `runningSessionKeys` shares one source with `countRunningSessions`, so there is no second counter. `RUNNING_CAP_MESSAGE` is a single constant. `startBlockReason`/`isSessionRunning` are small and readable.
- Wiring: `SessionGitStatsStore` is registered as a `MESSAGE_HANDLERS` multi-provider in `app.config.ts`, in the same shape as ChangeSetStore. It is `providedIn: 'root'`, uses `inject()`, has DestroyRef cleanup with timers cleared, and bounds concurrency (`MAX_CONCURRENT_READS`, one entry per root, not per card).
- Barrel-only imports are used everywhere in the diff.

## Five style questions (brief)

1. Six months out: a fourth surface for todos/git would copy a fourth set of titles (finding 3). If git root rules change, two normalizers have to change (finding 2).
2. A new reader will misread `findTabByIdAcrossWorkspaces?.(` as a method that may be absent, and will not know why `StreamPresentationStore` is public.
3. Maintenance cost: duplicated formatters plus a duplicated normalizer. About 30 lines to extract, which retires the cost.
4. Inconsistent with the repo: `normalizeRoot` is duplicated from `change-set.store.ts` despite the same-pattern precedent. The log prefix is hard-coded where the sibling uses a constant.
5. Differently: put `todoTitle`/`gitTitle` in chat-ui, export `normalizeWorkspaceRoot` once, and keep the barrel free of test-only symbols.

## File scores

- session-git-stats.store.ts 7/10 (S2, M4). Solid structure.
- compact-session-metrics.ts 8/10. Clean and pure.
- canvas-session-details.component.ts 6/10 (S3, M1). Wide computed chain.
- compact-session-activity.component.ts 6/10 (S3). Inline ternaries in a file that is already over 1200 lines.
- chat/src/index.ts 6/10 (S1).
- canvas.store.ts, canvas-running-cap.ts 8/10.
- chat-input.component.ts 7/10 (M3).
- session-context.token.ts, chat-types.ts, app.config.ts 8/10.

## Verdict

REVISE, high confidence on S1 and S2, medium on S3 (the divergence is real, but a shared helper's exact shape is a judgment call). A 10/10 version would: keep the barrel to production symbols; use one root normalizer; keep all state-to-label mapping in chat-ui; type the guard token; and drop the `?.` workaround.
