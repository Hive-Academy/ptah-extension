# Batch 60 executor report — N7 chip, banner, chat-view mount

Executor: frontend-developer. Worktree: `task-597-session-budget` (batches.md path roots name `task-597-followups`;
every path below is in `task-597-session-budget`). Nothing committed. batches.md not edited.

## Tasks

- 60.1 Chip `budget` input — done
- 60.2 `session-budget-banner.component.ts` — done
- 60.3 Mount in chat view and wire actions — done

## Files

- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts`: optional
  `budget: SessionBudgetState | null` input. `tokens` shows `14.9M / 50.0M`, with the numerator still
  `snapshot().tokenCount`. `cost` shows the badge plus `/ $30`. `cost-lower-bound` replaces the value with
  "≥ $x / $30 (some models have no price)". `weighted-fallback` replaces it with "est. <used> / <limit> weighted
  tokens (no price for this model)". The "Session budget: …" tooltip line is added to the TOKENS tooltip, or to the
  COST chip for the cost measures. Both layouts (collapsed bar and expanded cards) are covered. With no budget the
  DOM and tooltips are unchanged: the cost `title` is an attribute binding, so `null` adds no attribute.
- MODIFIED `.../session-stats-summary.component.spec.ts`: 5 new cases: no budget, tokens (numerator stays the
  snapshot when the budget's `used` differs), cost, cost-lower-bound, weighted-fallback.
- CREATED `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts`: a dumb
  component (standalone by default, OnPush, signal inputs and outputs), following the
  `resume-notification-banner.component.ts` pattern.
  - Inputs: `budget`, `preview`, `contextTokens`, `busy`.
  - Outputs: `dismiss`, `extend`, `restoreWindow`, `previewRequested`, `continueInNewSession`.
  - Roles: `status` for tighten and handoff, `alert` for limit.
  - The preview is `{{ }}` text in a `<pre>`: no innerHTML, no markdown. There is nothing to sanitize because
    nothing is parsed as HTML.
- CREATED `.../session-budget-banner.component.spec.ts`: 21 cases. Every stage and tighten variant (advisory,
  disabled, applied, and the 4 reasons), handoff (percent, compactions, write error), limit (blocked or not,
  lower-bound wording, cannot be dismissed), buttons and outputs, busy, the preview toggle, and the no-HTML
  rendering (a hostile `<img onerror>` stays text).
- MODIFIED `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`:
  - The chip gets `[budget]="resolvedSessionBudget()"`.
  - The banner is mounted right after the resume banner, in the `:127-137` slot.
- MODIFIED `.../chat-view.component.ts` (+111 lines, bindings and thin handlers only):
  - `resolvedSessionBudget` is `resolvedActiveTab()?.sessionBudget` (tile-aware), or the state the last action
    returned for the same session if it is not older (revision ≥).
  - `budgetPreviewText` and `budgetContextTokens`.
  - `onBudgetAction(dismiss|extend|restore-window)` and `onBudgetPreview()` (`preview-handoff`).
  - `onBudgetContinue()` calls `write-handoff`, then `createTab()` (+ `requestCanvasTab` in grid layout, like
    `TaskPromptBridgeService`), then `chatStore.sendOrQueueMessage(seed, { tabId })`.
  - One private `runBudgetAction` sets a busy guard, calls `session:budgetAction` and reports errors through the
    existing tab-scoped `ActionBannerService`. `'unavailable'` gets its own text. It uses `try/finally` with no catch,
    so degradation-audit is clean.
- MODIFIED `.../chat-view.component.spec.ts`: harness stubs (`sendOrQueueMessage`, `createTab` → `'tab-new'`,
  `requestCanvasTab`, `activeTabMock` exposed) and 13 cases:
  - pass-through; each of the 3 actions sends the UUID and the action.
  - action state shown until a newer snapshot; a newer tab budget wins.
  - unavailable and failed errors.
  - preview text.
  - continue sends only the seed to a new tab, grid adoption, no tab on failure, no budget means no RPC.

## Stack observed

Angular standalone components, signal `input()`/`output()`/`computed()`, `inject()`, OnPush (read from
`resume-notification-banner.component.ts` and `session-stats-summary.component.ts`). Tailwind and DaisyUI classes
(`btn btn-xs`, `border-info|warning|error`, `bg-base-300/30`). RPC goes through `ClaudeRpcService.call` and
`RpcResult.isSuccess()` (`core/.../claude-rpc.service.ts:129`). chat-ui imports only `@ptah-extension/shared` types
and no orchestrator libs.

## Text decisions (plan rev 2 § User-facing text + rev 1 § "User-facing text per stage (exact)")

Rev 1 was read from `git show d57e38bca:.../implementation-plan-addendum-n7-n8.md:363-392`.

- Tighten advisory: the title is "Half of this session's budget is used". The body is "<used> of <limit> <unit>. Run
  /compact or start a fresh session for unrelated work to slow the spend." Rev 2 writes this as one sentence with a
  parenthesis. It is split into the title and body shape every other stage uses, with the same words.
- Tighten not-applied reasons use the shared enum: env-override, already-lower, not-honoured (rev 2 text) and failed.
  Rev 1's "not-supported" has no enum value. `disabled` means advisory.
- Handoff body: the percent sentence when `percent` is known, plus the compaction sentence when `compactions > 0`. The
  banner does not know the configured thresholds, so it states both facts rather than guessing the trigger. "Ptah
  saved a handoff…" appears only when a handoff exists without `writeError`. Otherwise the write-failure line shows.
- Limit, `blocked`: "<amount>. New messages here are paused after the current turn (one queued message may still
  run). /compact and /clear still work. Continue in a new session that starts with only the handoff (about
  <chars/4> tokens instead of <main context>)."
  - "instead of …" appears only when the tab's live main-context figure is known.
  - With `blocked: false`, the text ends "New messages are not paused (blocking is off in settings)."
- Limit has no dismiss button (rev 1 buttons). `dismissedStage` is ignored at limit.
- The chip tooltip uses the rev 1 text verbatim ("At 50% … at 80% … at 100% …"). The budget state does not carry the
  configured percents, so the sentence names the defaults even when the settings differ.

## Verification

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat-ui @ptah-extension/chat @ptah-extension/dashboard ptah-extension-webview`
  → "Successfully ran targets typecheck, lint for 4 projects". The first run caught one TS18047 in
  `budgetPreviewText`, which was fixed before the rerun.
- Lint warnings on the touched files are pre-existing kinds only:
  - `max-lines` on the chip (758 → 859 counted lines; it was already over 700 at HEAD).
  - `max-lines` on chat-view (1014 → 1105; it was already over at HEAD).
  - One existing `no-non-null-assertion` at `chat-view.component.spec.ts:1307`, which is not in the new code.
- `npx nx run degradation-audit:lint --skip-nx-cache` → "Successfully ran target lint", all directories at baseline.
- `npx nx run-many -t test -p @ptah-extension/chat-ui @ptah-extension/chat --maxWorkers=2 --skip-nx-cache` →
  - chat-ui: 41 suites / 438 tests passed.
  - chat: 163 suites passed, 3033 passed and 2 skipped (pre-existing).
  - A direct jest run of the banner spec and the chat-view spec gives 87/87.
- Screenshots: not taken (QA, per instructions).

## Plan deviations

- Action state is held in chat-view. `TabManagerService` has no public budget setter, and chat-state is outside this
  batch. The state a `session:budgetAction` returns (dismiss, extend, restore) is held in a chat-view signal and
  wins over `tab.sessionBudget` only for the same session and a revision ≥ the tab's. The next stats broadcast
  (higher revision) replaces it.
- Continue uses `write-handoff`, not `preview-handoff`, so the seed reflects the transcript at click time. Both return
  the backend seed (AS-N7b), and the webview never assembles it.
- "Nothing else" caveat: the seed goes through the normal `sendOrQueueMessage` → `MessageSender.send` path. If the
  user has ultracode mode on, that path appends its keyword, as it does for every send. No other text is added: a
  fresh tab has no preamble.
- The preview button toggles between "Preview handoff" and "Hide handoff" (with `aria-expanded`). If the preview RPC
  fails, the error banner shows and the `<pre>` keeps "Loading the handoff…" until the user closes it.

## Out-of-scope observations

- Known gap, unchanged: the `chat:continue` refusal carries no budget state (Batch 56). The banner relies on
  `tab.sessionBudget` from the stats broadcast or resume.
- A small token and USD formatter is duplicated between the chip (chat-ui) and the banner (chat). These are two uses,
  so it was left separate per the simplicity rule.
