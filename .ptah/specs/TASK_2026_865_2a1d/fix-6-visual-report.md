# Fix 6: visual findings S1, S2, M1 and notice contrast

Verdict: S1, S2 and the notice contrast are fixed with class-only changes. M1 is not caused by this task (the composer has always behaved this way, and the harness typed `/compact` with `fill()`), so no code changed for it.

## How the contrast numbers were computed

- Tokens come from `apps/ptah-extension-webview/tailwind.config.js`: `anubis` uses hex values, `anubis-light` uses oklch values plus the `--bcm` tier.
- Each oklch value was converted to linear sRGB with the OKLab matrices, gamma-encoded and clamped. Alpha utilities were composited in sRGB over the surface. Luminance and ratio follow WCAG 2.x. The script is `/tmp/fix6/contrast.mjs`.
- The banner surface is `bg-base-300/30` over the chat background. Ratios are given over both base-100 and base-200 (the worst case). The disabled fill is DaisyUI 4.12.24's `.btn:disabled` rule: neutral at 20% opacity, with text at base-content/20%.
- These ratios are computed from tokens, not sampled from pixels. A fresh Electron capture should confirm them.

## S1 + S2: "Continue with <provider>" button contrast

**Change**
- `libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts:53`: `btn btn-xs btn-outline btn-primary gap-0.5 px-2` became `btn btn-xs btn-outline text-base-content-muted gap-0.5 px-2`.
- How it works: DaisyUI's `.btn-outline` sets `border-color: currentColor`, so the label and the border both take the muted text tier. `base-content-muted` is the repository's secondary-text token. It is pinned to at least 5:1 on base-300 in every theme by `src/app/base-content-muted.spec.ts`.
- Precedent: `btn btn-ghost ... text-base-content-muted hover:text-base-content` is already used on buttons in `libs/frontend/chat`. The plain `btn btn-xs btn-outline` is the pattern of the sibling `session-budget-banner.component.ts:88`.
- The button stays secondary: it is a muted outline next to the solid `btn-primary` "Re-authenticate in terminal" button.
- Hover is unchanged: the DaisyUI rule `.btn-outline:hover` (more specific than the colour utility) fills the button with base-content and sets the text to base-100.

**Busy spinner (state 3)**
- `auth-required-banner.component.ts:61-62`: the spinner gets its own `text-base-content-muted` class.
- Before, it inherited the disabled button's base-content/20% colour, because `.loading` paints with `currentColor`.
- The disabled label stays at 20% on purpose; the finding exempts it.

| Pair | anubis (b1 / b2) | anubis-light (b1 / b2) | Needed |
| --- | --- | --- | --- |
| Label before (primary on banner) | 3.41 / 3.24 | 1.33 / 1.22 | 4.5 |
| Label after (base-content-muted on banner) | **5.77 / 5.47** | **5.71 / 5.27** | 4.5 |
| Border before (= primary) | 3.41 / 3.24 | 1.33 / 1.22 | 3.0 |
| Border after (= currentColor, base-content-muted) | **5.77 / 5.47** | **5.71 / 5.27** | 3.0 |
| Hover after (base-100 text on base-content fill) | 14.86 | 15.91 | 4.5 |
| Busy spinner before (base-content/20% on disabled fill) | 1.75 / 1.77 | 1.47 / 1.46 | 3.0 |
| Busy spinner after (base-content-muted on disabled fill) | **5.70 / 5.46** | **3.87 / 3.60** | 3.0 |
| Re-auth primary button, unchanged (primary-content on primary) | 4.82 | 6.84 | 4.5 |

The before values match the reviewer's figures (about 1.3:1 in light, 3.2:1 in dark).

**Specs added** (`auth-required-banner.component.spec.ts:146`, `:157`)
- The button has `btn-outline` and `text-base-content-muted`, and does not have `btn-primary`.
- The busy spinner carries `text-base-content-muted`.
- The existing case that the "Re-authenticate" and "Dismiss" buttons are unchanged still passes.

## Notice contrast (states 4 and 5)

- Where it renders: `carryOverNotice()` is published through `ActionBannerService.showInfo` (`provider-carry-over.service.ts:427`). It renders in the shared action-info banner in `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:111-121`. Branch and rewind notices use the same banner.
- Before, the text was `text-success` on `bg-success/10`. That fails 4.5:1 in anubis-light.
- **Change** (`chat-view.component.html:115`): `text-success` became `text-base-content`. The green `bg-success/10` tint and `border-success/30` stay as the success cue. The template comment above it now says that carry-over notices also use this banner.
- Branch and rewind notices also get the higher-contrast text. That is the same fix for the same defect, and nothing else in them changes.

| Pair | anubis (b1 / b2) | anubis-light (b1 / b2) | Needed |
| --- | --- | --- | --- |
| Before (success on success/10 tint) | 5.03 / 4.66 | **2.15 / 1.94** | 4.5 |
| After (base-content on success/10 tint) | 13.29 / 12.31 | 14.51 / 13.06 | 4.5 |

**Spec added** (`chat-view.component.spec.ts:1877`): it uses the real `ActionBannerService` and renders the template. The `role="status"` notice must carry `text-base-content` and must not carry `text-success`.

## M1: slash palette stays open after a `/compact` carry-over (no change)

The open palette has nothing to do with this task. Evidence:

1. **The palette belongs to the composer, not the sender.**
   - `chat-input.component.ts` owns `_showSuggestions`.
   - It is opened and closed only by the `SlashTriggerDirective`, by selecting a suggestion (`closeSuggestions()` at :1463), and by the dropdown's `(closed)` output.
   - The directive (`libs/frontend/chat/src/lib/directives/slash-trigger.directive.ts:101`) reacts only to the textarea's `input` DOM events.
   - `message-sender.service.ts` and `provider-carry-over-launch.ts` cannot reach that state.
2. **Every send path clears the composer the same way.**
   - `handleSend()` (`chat-input.component.ts:1625-1689`) awaits `chatStore.sendOrQueueMessage(...)`, then sets `_currentMessage('')`.
   - A programmatic value change fires no `input` event, so `handleSend` never closes an open palette, on any path.
   - The carry-over path only returns a different `SendOutcome` from `continueConversation` (`message-sender.service.ts:928-935`). The composer runs the same clean-up afterwards.
3. **This task never touched the composer.** `git diff main --stat` on `components/molecules/chat-input/` and `directives/` is empty.
4. **The harness caused it.**
   - `_capture.spec.ts.txt:48-49` types the prompt with `ta.fill('/compact')` and then clicks `[data-testid="chat-send-btn"]`.
   - No command list is mocked, so the palette shows "No matches found".
   - With real keystrokes, Enter while the palette is open goes to the dropdown (`handleKeyDown`, :1600-1611), and the palette closes when a suggestion is picked. Send runs on Enter only while the palette is closed (:1613).
   - Any slash command sent by "fill, then click send" leaves the palette open on main too.
5. **Fixing it is out of scope.** It would mean a `closeSuggestions()` in `chat-input.component.ts`'s `handleSend`, which is not in this round's file list. It is recorded below as a follow-up.

## Verification

- **Jest**, run under the lock: `node scripts/verify.mjs --exec --task fix6-jest -- npx jest -c libs/frontend/chat/jest.config.ts <auth-required-banner.component.spec.ts> <chat-view.component.spec.ts>`. Result: 2 suites passed, 131 tests passed, exit 0.
- **ESLint**, run under the lock on the 4 changed files: 0 errors. There are 3 `no-non-null-assertion` warnings in `chat-view.component.spec.ts` at 1963, 2011 and 3040. These lines are not mine; they moved down by 21 lines because of the added case.
- **`ptah_get_diagnostics`** on the changed `.ts` files: no diagnostics in `auth-required-banner.component.ts` or its spec. `chat-view.component.spec.ts` reports type errors at lines 1809-1838, 2067-2097 and 2553-2652 (SubagentRecord mismatch, private or protected members). They are outside the added case (1877-1897), so they predate this change. Jest (ts-jest isolated) runs that file clean.
- **Not run**, per this round's limits: `npm run verify`, build, serve, e2e, and a fresh Electron capture. A visual re-check of states 2, 3 and 4 in both themes is still outstanding.

## Files changed

- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/components/molecules/notifications/auth-required-banner.component.spec.ts`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/components/templates/chat-view.component.html`
- MODIFIED `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts`

## Decisions

| # | Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| 1 | Continue button: `btn-outline text-base-content-muted` | (a) `btn-outline` alone, which gives full base-content at 14-15:1 but makes a heavy dark outline in light, louder than the teal primary; (b) `btn-ghost text-base-content-muted`, which has no visible boundary and fails the reviewer's 3:1 border ask; (c) chosen | `base-content-muted` is the repository's tuned secondary tier (at least 5:1 on base-300, pinned by spec); the same class is already used on chat buttons; the result is 5.27-5.77:1 for both label and border | Yes, one class |
| 2 | Spinner gets its own `text-base-content-muted` | Leave it inheriting currentColor (1.5-1.8:1), or use full base-content | `.btn:disabled` dims currentColor to 20%; the muted tier gives 3.6-5.7:1, at least 3:1 for a non-text indicator, without being louder than the label | Yes |
| 3 | Notice text becomes `text-base-content`; tint and border stay | Change the tint or border, or add a new success-ink token | `text-success` is 2.15:1 in anubis-light. The task forbids new theme tokens. base-content gives 13-14.5:1. Branch and rewind notices share the banner and get the same fix | Yes |
| 4 | M1: no code change | Add `closeSuggestions()` to the composer's `handleSend` | The palette is composer state driven by input events. This task's diff does not touch the composer. The harness used `fill()` plus a send click. `chat-input.component.ts` is outside this round's file list | n/a. Follow-up: have `handleSend` close an open palette after a send, in a separate change |
