# B10 report

## Summary

Implemented the canvas running-session cap at the composer send boundary. Canvas tiles and the detail transcript provide an optional guard; the ordinary chat view has no guard. A blocked send keeps text and attachments and shows the shared cap message in the existing composer alert. No 628-area file was edited.

## Send path found

`ChatViewComponent` hosts `ChatInputComponent` (`chat-view.component.ts:212,757`). The composer calls `ChatInputComponent.handleSend` (`chat-input.component.ts:1459-1494`), which calls `ChatStore.sendOrQueueMessage` (`chat.store.ts:256-260`), then `MessageDispatchService.sendOrQueueMessage` (`message-dispatch.service.ts:149-200`). The latter queues a busy tab or calls `MessageSenderService.send` at line 200. The guard runs before the composer calls `ChatStore`, preserving its draft on refusal. The `AGENT_SUMMARY_CHUNK` handler was untouched.

## Objective status

1. **Cap guard: complete.** `SESSION_START_GUARD` is optional (`session-context.token.ts:56`, exported `index.ts:36`); canvas tile and detail transcript provide it (`canvas-tile.component.ts:643-646`, `canvas-detail-transcript.component.ts:51-53`). `CanvasStore.startBlockReason` (`canvas.store.ts:225`) checks the existing cap and `isSessionRunning` (`:219`) against keys from one shared count implementation (`canvas-running-cap.ts:29-65`). The cap text is shared with the New session control (`canvas-running-cap.ts:7`, `orchestra-canvas.component.ts:381`). `ChatInputComponent.handleSend` (`chat-input.component.ts:1467-1471`) returns before sending or clearing text and attachments, using the existing role=alert notice surface (`:144-151`). No token means no cap outside canvas.
2. **One buildTree per published tab snapshot: bounded tile-level test added.** `canvas-tile.component.spec.ts:1315` mounts a tile with a probe that syncs one published `TabState` through the real `StreamPresentationStore`; it spies on `ExecutionTreeBuilderService.buildTree` and checks one call with `tab-tile-1`. This verifies the tile injector and presentation-store path. The full `ChatViewComponent` is replaced by the probe, so this test does not prove the full transcript's render behavior.

## Tests added or extended

- `chat-input.component.spec.ts:251-301`: cap refusal keeps text, file and image; cap notice signal; allowed canvas sends and ordinary chat send.
- `canvas.store.spec.ts:127-164`: nine running blocks an idle tile; eight allows; an existing streaming tile and a tile with a running agent retain a slot.
- `canvas-tile.component.spec.ts:1298-1335`: tile-scoped guard and one buildTree per published tab snapshot.
- `canvas-detail-transcript.component.spec.ts:1-95`: detail injector guard assertion and provider fixture.

## Checks run

All commands used `--parallel=1 --skip-nx-cache`; Jest commands used `--coverage=false --maxWorkers=2`.

- `npx nx test @ptah-extension/chat --testFile=chat-input.component.spec.ts ...`: 74 passed.
- `npx nx test @ptah-extension/canvas --testFile=canvas.store.spec.ts ...`: 19 passed (final code).
- `npx nx test @ptah-extension/canvas --testFile=canvas-tile.component.spec.ts ...`: 50 passed (final code).
- `npx nx test @ptah-extension/canvas --testFile=canvas-detail-transcript.component.spec.ts ...`: 2 passed (final code).
- `npx nx test @ptah-extension/chat ...`: 198 suites passed, 3,607 tests passed, 2 skipped. This preceded a three-line equivalent early-return simplification in the composer.
- `npx nx test @ptah-extension/canvas ...`: 26 suites passed, 319 tests passed. This preceded the final `startBlockReason` extraction; all affected specs then passed.
- `npx nx typecheck @ptah-extension/chat ...`: passed with one unrelated NG8107 warning.
- `npx nx typecheck @ptah-extension/canvas ...`: passed on final code, with the same warning.
- `npx nx lint @ptah-extension/chat ...`: passed, 0 errors, 37 existing warnings.
- `npx nx lint @ptah-extension/canvas ...`: passed on final code, 0 errors, 13 warnings.
- `ptah_get_diagnostics` was unavailable after 45 seconds; the scoped Nx typechecks passed.

## Files over 700 lines

| File                            |                Before | After |
| ------------------------------- | --------------------: | ----: |
| `canvas-tile.component.ts`      |                   871 |   877 |
| `chat-input.component.ts`       |                 1,586 | 1,594 |
| `canvas-tile.component.spec.ts` | baseline not recorded | 1,443 |
| `chat-input.component.spec.ts`  | baseline not recorded | 1,335 |

`orchestra-canvas.component.ts` is 694 lines. No other changed file exceeds 700 lines. The two spec baselines were not captured before editing; no git command was run per task instruction.

## Decisions

| Decision                                                           | Options                              | Evidence                                                                                                                      | Reversible |
| ------------------------------------------------------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Guard in the composer before `sendOrQueueMessage`                  | composer boundary, dispatch service  | Only canvas supplies the optional token; a block must retain draft and attachments (`chat-input.component.ts:1467-1494`)      | Yes        |
| Share running keys with the cap count                              | duplicate predicates, common key set | `CanvasStore` already derived the cap from canvas tabs and monitored agents (`canvas.store.ts:160-225`)                       | Yes        |
| Reuse existing composer alert                                      | new notice, existing alert           | Existing `role=alert` at `chat-input.component.ts:144-151` and timed cleanup                                                  | Yes        |
| Use a real presentation store with a tile probe for buildTree test | full ChatView harness, tile probe    | `StreamPresentationStore.sync` calls `buildTree` with `tab-${tab.id}`; full ChatView harness would pull in unrelated services | Yes        |

## Open items

The tile snapshot test replaces the full `ChatViewComponent` with a probe, so it does not exercise the full transcript's render behavior. No other B10 item remains open.
