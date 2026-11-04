# Batch 8 report: banner button and view wiring

Executor: frontend-developer subagent. I implemented Tasks 8.1 and 8.2. I ran no git command and
did not touch `libs/backend`, `libs/frontend/onboarding`, the Codex sign-in code, `batches.md` or
`task.md`. The AUTH_REQUIRED refusal path is unchanged.

All paths are under
`/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/`.

## Files

- MODIFIED `libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts`
- CREATED `libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`

## Task 8.1: `AuthRequiredBannerComponent` button

- New inputs: `carryOverProvider = input<string | null>(null)` and
  `carryOverBusy = input<boolean>(false)`. New output: `carryOver = output<void>()`.
- When `carryOverProvider()` is set, an `@if` block renders before the existing re-auth button:
  - a native `<button type="button">` with the visible label `Continue with {{ provider }}` and
    no `aria-label`, so the visible label is the accessible name;
  - `[disabled]="carryOverBusy()"` and `[attr.aria-busy]="carryOverBusy()"`. While busy, an
    `aria-hidden` DaisyUI `loading loading-spinner loading-xs` sits before the unchanged label
    (the same pattern as `send-to-messaging.component.ts:83`);
  - `aria-describedby` points to a `sr-only` span with a per-instance id (a module `nextId`
    counter, as in `confirmation-dialog.component.ts:24`), because several chat views can show
    the banner at once.
- The disclosure text is: "Sends this conversation's text to <provider> to start a new chat from
  a summary. Tool input, tool output and attachments are not sent, and known secrets are
  redacted." (AC 8.4; decisions.md rows 10 and 14.)
- Styling is `btn btn-xs btn-outline btn-primary gap-0.5 px-2`, taken from the banner's own
  button classes. The existing buttons, layout, copy, `role="alert"` and `aria-label` are
  unchanged. Without a provider the template output is the same as before. The `@if` adds no
  nodes, and the `sr-only` span is inside that `@if`.
- Keyboard order: the button is the first focusable control in the existing row, before the
  re-auth action and Dismiss.

What the spec (`auth-required-banner.component.spec.ts`) proves:

- No message: nothing renders.
- No provider: no carry-over button, no `.sr-only`, no `aria-describedby`. The two existing
  buttons match today's text, `aria-label`, classes and enabled state exactly (AC 1.2, 1.3). The
  Codex label is still "Re-authenticate in terminal".
- With a provider: there are 3 buttons, the carry-over button is first, and the other two
  describe exactly as they do without a provider (existing buttons unchanged).
- It is a native `type="button"` with no `aria-label` and the text `Continue with Codex` (the
  label equals the accessible name).
- `aria-describedby` resolves to a `sr-only` element with the exact disclosure text (AC 8.4), and
  each instance gets its own id.
- Default: enabled, `aria-busy="false"`, no spinner. Busy: disabled, `aria-busy="true"`, label
  unchanged, spinner is `aria-hidden`.
- A click emits `carryOver` exactly once and emits neither `reauth` nor `dismiss`. A busy click
  emits nothing. With a provider set, the re-auth and Dismiss buttons still emit their own
  outputs.
- Clearing the provider removes the button and the disclosure.

## Task 8.2: `ChatViewComponent` offer binding

- `chat-view.component.ts` injects `ProviderCarryOverService` and adds:
  - `carryOverOffer = computed<CarryOverOffer | null>`: the service offer only when
    `authRequiredBanner()?.generation === offer.generation` and
    `offer.tabId === resolvedTabId()`, otherwise `null` (AC 7.3). The service's `offer` already
    checks the generation. The view checks it again because the plan says so, and the extra check
    costs nothing;
  - `carryOverBusy = computed`: `isPending(offer.tabId) || isBusy(offer.sessionId)` for a bound
    offer, otherwise `false`. A `/compact` carry-over of the same session therefore disables the
    button (Rev 2);
  - `onCarryOver()`: reads the current `carryOverOffer()` and calls `start(offer)` once when it is
    non-null. `start` does its own click-time re-checks (AC 7.2) and failure handling.
- `chat-view.component.html` (the auth banner block) binds
  `[carryOverProvider]="carryOverOffer()?.providerName ?? null"`,
  `[carryOverBusy]="carryOverBusy()"` and `(carryOver)="onCarryOver()"`. The existing bindings are
  unchanged.

What the spec proves. Harness changes: the auth-state stub's `authRequiredBanner` is now a typed
`signal<AuthRequiredBanner | null>` (`authBannerSig`) that carries `generation` and `origin`. A
`ProviderCarryOverService` stub is in the provider list. The harness exposes
`carryOverOfferSig`, `carryOverPendingTabs`, `carryOverBusySessions` and `carryOverStartMock`.
The new describe block renders with `renderCompactTemplate`, so `ptah-auth-required-banner` is an
unknown element under `NO_ERRORS_SCHEMA`, its property bindings can be read, and its `carryOver`
output can be fired as a DOM event:

- Matching tab: `carryOverOffer()` equals the offer. The banner element gets
  `carryOverProvider = 'Codex'` and `carryOverBusy = false`. Firing `carryOver` calls `start`
  once, with the offer.
- A view of another tab (`sessionContextTabId: 'tab-other'`): `null`, the banner still renders
  with `carryOverProvider = null` (today's banner), and firing the output does not call `start`
  (AC 7.3).
- The main panel follows the active tab: switching `activeTabId` away gives `null`.
- Stale generation (banner 4, offer 3): `null`, the provider binding is `null`, and `start` is not
  called (AC 7.3).
- No banner: `null`.
- Busy: true when the refused tab is pending, and true when the refused session is busy
  elsewhere.

## Verification

- `ptah_get_diagnostics` with `files` set to the four changed `.ts` files, run twice: the result
  was "TypeScript check still running after 45s" both times, so all 4 files are unchecked. As
  briefed, I moved on, and no type check has run. The template binding in `.html` is checked
  only by the Angular compiler in CI.
- As decisions.md row 51 says, I ran no `npm run verify`, nx, jest or tsc locally, and no
  build or serve. The specs have not been run. CI on draft PR #914 runs them.

## Decisions

| # | Decision | Options | Evidence | Reversible |
| - | -------- | ------- | -------- | ---------- |
| 1 | The disclosure adds the plan sentence and an exclusions sentence: "Tool input, tool output and attachments are not sent, and known secrets are redacted." | Plan sentence only; plan sentence plus exclusions. | The brief asks for the exclusions to be disclosed. decisions.md rows 10 and 14 confirm the policy. AC 8.4 sets the minimum. | Yes (text only; spec pins it) |
| 2 | The new button uses `btn-outline btn-primary`, not a second filled `btn-primary`. | Filled primary; outline primary; ghost. | The existing re-auth button must stay unchanged, and two filled primaries would compete. `btn-xs btn-outline` is already used in `session-budget-banner.component.ts:88`. | Yes (class only) |
| 3 | The busy state shows an `aria-hidden` spinner and keeps the label. | Change the label to "Starting..."; keep the label. | The label must equal the accessible name. `aria-busy` and `disabled` carry the state. | Yes |
| 4 | The disclosure id comes from a per-instance counter. | Fixed id; counter. | Canvas tiles can render several banners. Pattern in `confirmation-dialog.component.ts:24`. | Yes |
| 5 | The view spec uses `renderCompactTemplate` mode. | Default (no render); compact template with `NO_ERRORS_SCHEMA`. | The plan leaves the mode to the implementer. This mode makes the input bindings and the output observable without the banner's DI. | Yes |

## Deviations

- None from the file list.

## Out-of-scope observations

- `onAuthBannerDismiss()` and the non-Codex branch of `onAuthReauth()` still call
  `clearAuthRequiredBanner()` with no generation, so they clear whatever banner is current at the
  time of the click. This is unchanged from before and is not part of this batch. The phase
  review may want to pass the shown banner's generation.
- The visual "after" screenshots (with the button, the busy state, and the notice) are for the
  visual-reviewer after the commit.
