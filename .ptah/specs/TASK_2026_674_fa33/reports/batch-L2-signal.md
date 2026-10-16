# L2 signal follow-up

## Injector trace

- `SESSION_EMBED_CHROME` is typed as `'full' | 'bare'` in `libs/frontend/chat/src/lib/tokens/session-embed-chrome.token.ts:4-11`. `bare` removes the hosted chat header and inspector; absent or `full` keeps them.
- `libs/frontend/chat/src/lib/components/templates/session-embed.component.ts:46,60,81-84` creates the hosted `ChatViewComponent` with a child environment injector that provides the current `chrome()` value. Its default is `full`. The same injector provides `RAIL_TRANSCRIPT_RETENTION` from `retainRailTranscript()` at lines 93-96.
- Canvas focus uses `ptah-session-embed` in `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:22-31`. It binds `[retainRailTranscript]="true"` but does not bind `chrome`, so the compact card rendered by `chat-view.component.html:13` receives **`SESSION_EMBED_CHROME = 'full'`** and **`RAIL_TRANSCRIPT_RETENTION = true`** through the embed child injector.
- Canvas Rail renders the card directly in `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:107,141`. Its component providers at lines 50-56 contain `SESSION_CARD_ACTIONS` and `SESSION_FORCED_CARD`, with no chrome provider. This card is outside the focus embed's child injector, so it receives **no `SESSION_EMBED_CHROME`**. The card's Canvas duplicate suppression affects the tile branch at `compact-session-card.component.ts:142-160`; the Rail branch starts at line 124.
- Plain chat renders the card through `chat-view.component.html:13` with no session embed, so optional chrome injection is **absent**. `chat-view.component.ts:1101` already treats only `bare` as hosted bare chrome.
- The `/setup-hub` route loads `SetupHubComponent` (`apps/ptah-extension-webview/src/app/app.routes.ts:144-150`), which does not host a session embed. The Setup Hub's builder route loads `HarnessBuilderViewComponent` (same file, lines 118-140), whose session embed binds **`chrome="bare"`** at `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts:244`. Its hosted card therefore receives `bare` when a compact card is shown. This value is distinct from Canvas focus's `full`, but it expresses a chrome layout shared by hosts rather than Canvas identity.

## Change and spec cases

No source or spec changed. `SESSION_EMBED_CHROME` does not identify Canvas unambiguously across the two Canvas locations: focus receives `full`, which has ordinary chrome semantics, and Rail receives no token, like plain chat. Replacing the existing `RAIL_TRANSCRIPT_RETENTION === true` condition in `compact-session-card.component.ts:214-216` would change host behavior. The existing Canvas cases in `compact-session-card.component.spec.ts:211-239` assert hidden title and Full view while retaining status, needs-you count, and the empty-card status word. Its default test provider sets retention to false at line 179. No new cases were added because the requested conditional source change is unsafe.

## Check results

- `ptah_get_diagnostics` scoped to the card and spec: card source had no reported errors. The unchanged spec has three existing TypeScript errors at lines 318 (two branded ID assignments) and 879 (number versus null). The tool also reported unrelated sibling errors; no files were edited.
- Focused Jest command on `compact-session-card.component.spec.ts`: **1 suite passed, 49 tests passed**. No Nx, build, lint, or e2e run.

## Decisions

- **Decision:** Keep the existing retention signal and make no source change. **Options:** infer Canvas from `full`/`bare`/absence; add a distinct Canvas chrome value and provide it at both Canvas sites; retain the existing signal. **Evidence:** injector trace above and current `full | bare` semantics. **Reversible:** yes; a later cross-component change can introduce an explicit Canvas value and update the card.

## Clarifications Needed

1. Should a later batch expand ownership to add an explicit Canvas chrome value and provide it to both Canvas focus and Rail, or keep the working retention signal? **(Recommended) Keep the retention signal** within this scoped follow-up; `full`/`bare` cannot express Canvas identity without changing other components. **Alternative:** expand scope to define and wire a Canvas-specific value, then update the card and tests together.
