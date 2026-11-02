# Code Logic Review — Batch B1c part A (TASK_2026_ONBOARDING)

Review family: ollama-cloud (implementer: claude)

Reviewed: the uncommitted working-tree changes in the onboarding-module worktree
(`ready/` directory + first-run/route/shell/home/webview spec updates).
Harness captures and screenshots are part B and out of scope.
Read in full: every file under `libs/frontend/onboarding/src/lib/ready/` (sources),
the modified `onboarding-flag.service.ts`, `onboarding-first-run.guard.ts`,
`onboarding.routes.ts`, `onboarding-shell.component.ts`, `onboarding-home.component.ts`,
and the diffs of the four webview/onboarding spec files; plus the plan addendum
`implementation-plan.addendum-prereqs.md` §218-438, §523-745, §1151-1237 and the
contract sources in core (`claude-ambient-status.service.ts`,
`providers-settings-state.service.ts`, `providers-settings-sections.ts`) and chat
(`providers-settings.component.ts` drawer effect). Tests were reported passing
(onboarding, webview; electron/vscode lint+typecheck); I did not re-run them and ran
no build/serve/e2e/workspace-wide checks.

## Requirement verification (user rule and plan)

- **Stage 2 reuses the existing settings components**: `ready-settings-step.page.ts:11-18`
  imports `ProvidersSettingsComponent` and `CliOrchestrationMatrixComponent` from
  `@ptah-extension/chat/settings-embed` and embeds them unchanged (`:160`, `:198`).
  No onboarding-specific provider/model/account/CLI form exists anywhere under
  `ready/`. The only reads the onboarding code issues itself are
  `ProvidersSettingsStateService.redetectClis()` and `ClaudeAmbientStatusService.read()`
  (`claude-readiness.store.ts:127-130`) — exactly the sanctioned set. The page also calls
  `settingsState.open()` once per CLI-panel mount (`ready-settings-step.page.ts:338-340`),
  which is RD5-prescribed and mirrors the real settings host
  (`orchestration-settings.component.ts:81`); the embedded Providers component calls it
  itself on mount (`providers-settings.component.ts:1096`). No new RPC. Rule holds.
- **Flag `ready` slice**: parsed leniently on its own — `ready: z.unknown().optional()` at
  the top level, then `readySchema.safeParse` with drop-to-`{}` on failure while the three
  top-level fields are kept (`onboarding-flag.service.ts:21-27`, `:180-192`). A malformed
  `ready` never costs `shownAt` and never triggers a redirect (spec cases: string,
  non-datetime field, null → `{ shownAt: SHOWN, ready: {} }`, ineligible). An unknown
  top-level key stays unreadable → no redirect, and `write()` never persists over an
  unreadable record (`:159-167`, in-memory only).
- **Merge writes**: all marks go through the shared `write(change)` read-modify-write of
  the whole record (`:146-184`). `markReady` spreads `...flag.ready` (`:126-133`); the
  top-level marks spread `...flag` so `ready` survives `markDismissed` (spec pins it).
  A failed `markReady` write is swallowed, logs, and does not suppress (catch at `:176-183`
  sets no suppression flag).
- **Guard target**: `ready?.claudeAt || ready?.skippedAt` → `/onboarding`, else
  `/onboarding/ready` (`onboarding-first-run.guard.ts:33-36`). Only `claudeAt`/`skippedAt`
  count; `settingsAt` alone still targets stage 1 (spec pins it). Eligibility and the
  tracker are untouched; the tracker commits `shownAt` once on the `/onboarding/ready`
  arrival (new tracker spec row), and the guard spec asserts `markShown` times(1).
- **Buttons**: Continue → `markReady('claudeAt')` → `ready/settings` (`ready-claude-step.page.ts:541-554`);
  Continue anyway (every non-ready state incl. checking, and it is the only action while
  checking) → `skippedAt` → same target; Skip for now → `skippedAt` → `/onboarding`;
  Continue to setup → `settingsAt` → `/onboarding`; Back → `/onboarding/ready`. All
  verified in source and pinned by specs (including `it.each` over non-ready states).
- **Re-check concurrency**: double-click is guarded twice — `recheck()` early-returns while
  `rechecking()` (`:536`) and the button is aria-disabled with the same state driving the
  "Checking..." label; the store counts in-flight fresh refreshes so overlapping calls
  cannot underflow (`claude-readiness.store.ts:104,117,125-132`). Stale results cannot
  overwrite newer ones at the owners: the ambient service applies only the reply to the
  latest `read()` (`claude-ambient-status.service.ts:56,73-77`) and the section store
  keeps per-call generations with latest-wins. Store state after failure/timeout is a
  settled `error` view with the right cause; `refresh` never throws.
- **Derivation**: `deriveClaudeReadiness` (`claude-readiness.store.ts:56-88`) matches the
  plan table in order checking → missing → error → signed-out → ready, including the
  precedence cases (missing beats error via the ambient `cli-missing` arm; detect error
  with ambient `connected` → error; `unknown` without reason → error/local; missing row →
  error/local; `!result`/`localFailure` → error before any signed-out/ready read). The
  store spec covers every row plus precedence.
- **Drawer request**: seeded once from `ActivatedRoute.snapshot` in the constructor with a
  stable-identity module constant; any tab change clears it
  (`ready-settings-step.page.ts:287-311`); the reused component opens it once per request
  key and will not reopen on close while the input is bound
  (`providers-settings.component.ts:1041-1060`). No loop.
- **VS Code zero RPCs**: `onboardingReadyHostGuard` redirects `/onboarding/ready*` to
  Home outside Electron (`onboarding-ready-host.guard.ts:9-11`; routes spec pins both
  URLs → `/onboarding`), so neither stage mounts. Home gates the strip, banner and footer
  link on `readyAvailable` and skips `refresh` when false. The store no-ops when
  `available` is false. Zero `agent:detectClis` / `provider:getAmbientClaudeStatus` calls.
- **@defer embeds**: both tabpanels have `@defer (on immediate)` with an `aria-busy`
  placeholder and a `role="alert"` Reload fallback calling
  `document.defaultView.location.reload()` (`ready-settings-step.page.ts:159-186`, `:197-224`).
- **Page-scope providers**: `READY_SETTINGS_PROVIDERS` (`SettingsSaveFeedbackService`,
  `PROVIDER_MODELS_LOADER` → `ProvidersModelsLoader`) provided on the `ready/settings`
  route (`onboarding.routes.ts:32-36`); `<ptah-settings-toast />` at page root; spec
  resolves both from the tabpanel element injector (R19).
- **Cleanup**: the Copied timer is cleared on destroy (DestroyRef) and on every new copy
  (`command-copy-row.component.ts:74-101`); no other timers/subscriptions were added.
  A failed clipboard write shows the inline fallback and keeps focus on the button.
- **h1 focus on entry**: satisfied by the shell's `focusHeading` on every outlet
  activation (`onboarding-shell.component.ts` `onPageActivated`), not by the pages; both
  h1s are `tabindex="-1"` and the claude-step spec asserts focusability. Works for both
  ready children.

## Findings

1. **[minor] Focus is dropped to the page when Re-check resolves `ready`** —
   `ready-claude-step.page.ts:424-459` and `:535-539`. The action row switches on
   `view().state === 'ready'`: the Re-check button that the user pressed (and plan
   requires to keep focus while it runs) is removed from the DOM, so focus falls to
   `body` and the keyboard/screen-reader user loses their place after an explicit
   action. The announce fires, but the focus position is lost. This is the issue the
   implementer flagged; confirmed as real.
   Fix: keep the focus on the primary action across the swap — e.g. add
   `viewChild<ElementRef<HTMLButtonElement>>('continueBtn')`, put the template ref on the
   Continue button, and in `recheck()` after `await this.store.refresh(true)`, when the
   resolved state is `'ready'`, call `this.continueBtn()?.nativeElement.focus()`
   (guarded, e.g. only when the previously focused element is no longer connected). For
   missing/signed-out/error the Re-check button remains, so no change is needed there.
   Severity: minor (a11y regression on one transition; no data or navigation defect).

2. **[minor, latent] `inert` ambient status is not a `checking` input** —
   `claude-readiness.store.ts:63-69` checks only `checking`/`idle`, but
   `ClaudeAmbientStatusView.status` also has `'inert'`
   (`claude-ambient-status.service.ts:26`, initial view `INERT` when not Electron,
   `:53-55`). Today it is unreachable in practice: in Electron the initial view is
   `IDLE`, and outside Electron nothing mounts the pages or renders the banner, so the
   function never sees `inert` paired with a settled detection. But
   `deriveClaudeReadiness` is an exported pure function; fed an `inert` view with a
   settled detection (a future consumer, or a pre-first-read derive) it returns
   error/signed-out/ready instead of `checking`. One-line fix: add
   `ambient.status === 'inert'` to the checking arm. Low severity because unreachable
   in the current wiring.

Not counted as defects, for the record:
- Strip item 2's marker for the `skipped` word is `idle` (`ready-strip.component.ts:164`,
  only `done` gets a filled badge). §12.6's marker legend names current/done/need only;
  the word "Skipped" is shown as real text. Part B's visual review should confirm this
  matches §12.6.
- The drawer seed compares the raw `area` query string
  (`ready-settings-step.page.ts:295-299`), so junk `area` values that parse to
  `providers` do not open the drawer. This matches the plan seam literally
  ("only with `area=providers&open=claude-accounts`") and its spec cases; noted, not a
  defect.
- Copy fidelity against spec §12.2/§12.3 (chip labels, lines, PATH hint, banner lead
  sentences) is asserted in the page specs but I did not have the spec text itself; the
  part-B visual review is the right gate for verbatim copy.

## Five logic questions

1. **Silent failure?** Flag write failures are swallowed by design and cannot suppress the
   redirect (verified: the catch sets no suppression). A malformed `ready` reads as `{}` —
   silent by design, keeping `shownAt`. No unintended silent-success found.
2. **Unexpected user action?** Re-check → ready drops focus (finding 1). Everything else
   traced: Continue anyway during the in-flight mount read navigates safely (latest-wins
   owners), tab switches clear the drawer, Back/continue paths write the right keys.
3. **Wrong answer instead of error?** `ready: null`/string/bad dates → dropped slice, top
   level kept; unknown top-level key → unreadable, no redirect, no overwrite; junk
   `area`/`open` query → `providers`/`null`; equal timestamps → `done` (plan: "not older").
4. **Dependency failure/timeout/shape?** Ambient localFailure or null result → error/local
   before any signed-out/ready read; detect error → error/local (a stale retained row
   cannot fake `missing`, because the installed arm requires `detection.status === 'ready'`);
   timeout/unreadable reasons map to their causes; chunk load failure → Reload fallback;
   clipboard rejection → inline fallback.
5. **Missing?** Nothing the plan names is absent: guard target, tracker row, webview
   settle case for `/onboarding/ready`, crumb, page-scope providers, defer fallbacks,
   announcer strings, OS tab preselect from `config().platform`, `rel="noopener noreferrer"`
   docs link, arrow-key wrap, VS Code gating — all present and spec-pinned.

## Score

9/10 — exemplary with one minor a11y defect and one latent gap, both with concrete,
one-line fixes. The flag merge/lenient-parse logic, the guard target, the derivation
table and the concurrency handling match the plan exactly and are pinned by specs; the
two findings are what separate this from a perfect score, and neither blocks delivery.

Verdict: APPROVED