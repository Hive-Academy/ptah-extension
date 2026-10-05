# Batch B7 report — transcript live-window order key + Electron sender flag (TASK_2026_610)

Status: **done**. Both tasks implemented, verified with the batch's commands.

## Files

| File | Action | Purpose |
| --- | --- | --- |
| `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts` | MODIFY | `ptahUiOrderKeys` computed (order-key map for the live window) |
| `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html` | MODIFY | `[ptahUiOrderKey]` binding on `<ptah-message-bubble>` (`.html:53`) |
| `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.ptah-ui.spec.ts` | CREATE | 4 cases: one window per transcript, two tabs → two windows, per-bubble keys, VS Code default |
| `libs/frontend/chat/src/lib/services/message-sender.service.ts` | MODIFY | `ptahUiFence` spread on `chat:start` (`:449`) and `chat:continue` (`:703`) |
| `libs/frontend/chat/src/lib/services/message-sender.service.spec.ts` | MODIFY | New `describe` (`.spec.ts:895`) — 4 flag cases; no existing test modified |
| `libs/frontend/chat/src/lib/components/organisms/transcript/testing/transcript-spec-harness.ts` | MODIFY (consequential) | See below |

**Consequential edit outside the batch's file list** — `transcript-spec-harness.ts:32-35`: the
`PtahUiLiveWindow` provider itself was already landed by B6 (commit `2dac29bcb`, untouched here),
but the shared test stub `TranscriptMessageBubbleStub` lacked a `ptahUiOrderKey` input. Every
committed transcript spec (`chat-transcript.component.spec.ts`, `.change-set`, `.older-history`,
`.replay-motion`, `.replay-mount`) replaces `<ptah-message-bubble>` with that stub, so the new
`[ptahUiOrderKey]` binding would fail their template compilation ("Can't bind to 'ptahUiOrderKey'
since it isn't a known property"). One `@Input() ptahUiOrderKey = 0;` line (mirroring the real
`MessageBubbleComponent.ptahUiOrderKey` input, confirmed at `message-bubble.component.ts:138`) keeps
all five suites green; all 10 affected suites were run and pass (except the unrelated failure
below). This was unavoidable — the alternative was breaking 5 committed spec files.

## B7.1 — how the order key is computed

- `chat-transcript.component.ts:496` — `ptahUiOrderKeys: computed<ReadonlyMap<string, number>>`
  built from the gated `vm().messages` via `transcriptOrderKey(msg)`
  (`transcript-change-set-anchors.ts:25` → `msg.streamingState?.startTime ?? msg.timestamp`, the
  stable clock that keeps streaming and finalized assistant messages comparable). The template reads
  `ptahUiOrderKeys().get(msg.id) ?? 0` (`.html:53`) — the same read-a-computed-Map pattern the
  template already uses for `changeSetAnchors().get(msg.id)` (`.html:72`), no method call in the
  template.
- Derived purely from `vm()`, so the freeze discipline is inherited: while a transcript is hidden,
  `vm()` returns the frozen snapshot and the map stays cached; reactivation recomputes it exactly
  once, O(messages).
- **Electron-only** [user scope], matching the plan's "nothing is computed on VS Code" quality bar
  and the sibling `turnTestsAnchors` gate: non-Electron returns the shared `EMPTY_ORDER_KEYS`
  (`.ts:63`), so VS Code bubbles keep the input's `0` default, which their always-`null` `ptahUi`
  context (`message-bubble.component.ts:177-185`) never reads.

Spec cases (all pass): exactly one `PtahUiLiveWindow` per transcript (root injector throws — it is
not a global provider — while the transcript injector and every bubble injector under it resolve
the same instance); two transcripts standing for two tabs resolve two different instances with
their bubbles wired to their own; bubbles get keys `[100, 105, 200, 210]` where `105` is the
streaming tree's `startTime` beating the message's own `5_000` timestamp (stable streaming clock,
key grows with transcript order); on VS Code all bubbles keep the `0` default.

## B7.2 — sender sites

`MessageSenderService` field name confirmed as `this.vscodeService`
(`message-sender.service.ts:78`); `isElectron` is a getter on the real `VSCodeService`
(`vscode.service.ts:171`). The spread `...(this.vscodeService.isElectron ? { ptahUiFence: true } : {})`
is at:

- `chat:start` params — `message-sender.service.ts:449` (after `ptahCliId`, before `options`)
- `chat:continue` params — `message-sender.service.ts:703` (after the `resolvedWorkspacePath` spread)

These are the only two RPC call sites in the file (verified by grep). Absence (VS Code) sends no
key at all, not `ptahUiFence: false`, so the optional reads as "no surfaces". New spec cases
(`message-sender.service.spec.ts:925-950`): Electron → `ptahUiFence: true` in both `chat:start` and
`chat:continue` payloads; `isElectron=false` → `'ptahUiFence' in payload` is `false` for both. The
host gate is set by mutating the injected `VSCodeService` stub's `isElectron` before `send()`. No
existing test was modified.

## Verification

1. `npx jest -c libs/frontend/chat/jest.config.ts <chat-transcript.ptah-ui.spec.ts> <message-sender.service.spec.ts> <message-sender.host-data.spec.ts>` (with `--maxWorkers=2`):

   ```
   PASS chat libs/frontend/chat/src/lib/services/message-sender.service.spec.ts
   PASS chat libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts
   PASS chat libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.ptah-ui.spec.ts
   Test Suites: 3 passed, 3 total
   Tests:       50 passed, 50 total
   ```

   50 = 8 new (4 + 4) + 42 pre-existing. The committed `message-sender.host-data.spec.ts` stays
   green, and `ptahUiFence` rides the params only — its VSCodeService stub has no `isElectron`, so
   the key is absent there, confirming the flag is not host data.

2. Extra scoped check (harness consumers, same jest project):
   `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/components/organisms/transcript/`
   → **10/11 suites pass, 112/114 tests**. The one failing suite is
   `transcript-turns.spec.ts` (2 deep-equality failures at its `:184`/`:203`). It is **not affected
   by this batch**: it imports only `@ptah-extension/shared` and `./transcript-turns`, neither in
   my change set (`git status` shows my six files above), and this shared worktree carries a
   parallel agent's uncommitted edits to `libs/shared/src/lib/utils/turn-tests.utils.ts`,
   `test-command-matcher.ts`, `libs/shared/src/lib/types/execution/node.ts` and
   `chat-execution-tree/builders` (the `outcome`/run-shape code those assertions compare). I did
   not touch those files; flagging for the orchestrator.

3. `npx nx run-many -t typecheck,lint -p @ptah-extension/chat --parallel=1` →

   ```
   NX   Successfully ran targets typecheck, lint for project @ptah-extension/chat
   ```

   Exit code 0 (the trailing "Nx Cloud … FREE plan" notice is a disabled-cloud message, not a
   task failure).

## Notes

- The B6 provider (`providers: [TranscriptRenderWindow, PtahUiLiveWindow]`,
  `chat-transcript.component.ts:166`) was left as landed — no duplicate provider added, per the
  scope change of 2026-10-04.
- Not blocked; no clarifications needed.
