# Code Logic Review — B1c Part B (webview-e2e-harness onboarding scenarios)

- Review family: ollama-cloud
- Reviewer role: code-logic-reviewer (independent lane; not an implementer of this code)
- Production implementer: Claude; capture-fix implementer: codex
- Verdict: **APPROVED** (harness logic only; the screenshot gate itself is NOT met — see Limitations)
- Score: **8 / 10** (sound; minor latent issues, none blocking)
- Scope: the three new harness files in `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/`:
  - `onboarding-ready.fixtures.ts`
  - `onboarding-ready-capture.ts`
  - `onboarding-ready-visual.e2e.spec.ts`
- Requirements read: `implementation-plan.addendum-prereqs.md` component 12 (lines 806-890),
  the "Visual layer" contrast/reduced-transparency sections (lines 1064-1080), and `context.md`
  screenshot permissions (lines 70-72) plus the B1b-capture decision (lines 86-88).
- Prior failures consulted: `b1c-capture-fix-report.md` (its selectors were re-validated
  independently against production markup, not taken on trust).

## Verdict rationale

The 116-case matrix matches the approved requirements exactly: 80 four-theme captures
(7 + 6 + 5 + 2 per theme), 4 B1b Credentials-drawer captures (context.md orchestrator
decision 2026-10-29), 2 reduced-transparency captures and the 30-run contrast sweep.
Every state literal I checked matches production byte for byte. Both selectors that
failed in the codex capture run are now correct against the real markup. The findings
below are latent or low-impact; none captures a wrong state today.

## Findings

### F1 — Low — axe pass can describe a state the screenshot does not show (checking captures)

`onboarding-ready-capture.ts:101-106`: `captureOnboarding` takes the screenshot first and
runs axe afterwards. For the `checking`, `checking-ambient` and Home-`checking` captures the
readiness RPCs are never answered, so the panel flips to a timeout error view when the 30 s
client timeout fires.

Failure scenario: on a slow machine the axe pass begins near t = 30 s after boot; the
ambient client timeout fires mid-analysis; the DOM switches to "Could not check"; the axe
JSON is written under the `checking` label while the PNG shows the checking state.
Impact: mislabelled accessibility evidence only; the image itself stays correct. The
addendum (line 836) documents "well inside the 30 s client timeouts" as the accepted
mitigation, so this is a residual, not a regression. No change required now.

### F2 — Low — the `?? ''` fallback can silently pass a wrong strip word

`onboarding-ready-visual.e2e.spec.ts:196`: `expectStripWord(page, 1, STRIP_WORD[DERIVED_STATE[id]] ?? '')`.
If a derived state were ever missing from `STRIP_WORD`, `toContainText('')` matches any text,
so the assertion would pass vacuously instead of failing the capture.

Failure scenario: a future readiness id maps to a derived state absent from `STRIP_WORD`;
the stage-1 capture shoots without a strip-word check and reports success. Today the map is
total (`checking`, `ready`, `missing`, `signed-out`, `error` all present, verified against
`ready-strip.component.ts:33-37`), so the defect is latent only. A keyed record typed on
`ReadinessFixtureId` (like `STAGE_ONE_TEXT`) would make TypeScript catch the gap.

### F3 — Low — the settled-wait list is a fixed selector set

`onboarding-ready-capture.ts:30`: `waitForSettledOutsideReadiness` waits only on
`[aria-busy="true"], .loading-spinner, [data-read-loading]`. A loading region outside the
readiness panel and the strip that used a different marker would not be waited on, and the
capture could show an in-progress region. I could not enumerate every loading marker in the
embedded settings surfaces within this lane's budget, so this is unconfirmed; the list
mirrors the `settings-capture.ts` precedent the addendum names (line 846). Recording it as
an uncertainty, not a defect.

## Requirement checks

| Requirement (addendum component 12 / context.md) | Result | Evidence |
| --- | --- | --- |
| 8 readiness fixture ids, only `agent:detectClis` + `provider:getAmbientClaudeStatus` overridden | PASS | `onboarding-ready.fixtures.ts:69-131`; the per-id table matches addendum lines 817-826 exactly |
| `error-local` uses a resolver (`rpcError`), not a static value | PASS | `:128` `() => rpcError('detect failed')`; responder honours resolvers only (`marketplace.fixtures.ts:136-150`); local-cause sentence asserted, matching `ready-claude-step.page.ts:92` |
| `checking` ids keep RPCs unanswered (key removed) | PASS | `NEVER_ANSWERED` deletion at `:176-179`; responder never answers an unfixtured method |
| Ambient replies pass the boundary validator | PASS | `{ ok, status: { state, checkedAt, reason? } }` matches `isAmbientStatus` (`claude-ambient-status.service.ts:115-124`); states/reasons are the documented sets |
| Boot mirrors `bootSettings`; Electron host | PASS | `installHost(page, 'electron', 'chat')` at `:195`; with a flag, Home via `switchView` (`:214-216`), as the addendum requires |
| Capture path `<view>-<theme>-<w>x<h>.png` under `screenshots/ready`, cwd-independent | PASS | `onboarding-ready-capture.ts:23-26, :85-87` |
| Theme wait (A5), pointer parked, animations disabled, busy regions exempted | PASS | `:50-69, :98-102`; `checking` (`aria-busy` by design) stays capturable |
| Axe per capture, JSON next to image; sweep restricted to `color-contrast`; violations are findings, not capture failures | PASS | `:104-131`; `axeRules: ['color-contrast']` in the sweep (`spec:382`); annotation records count and path |
| Contrast sweep 3 views × 2 glass themes × (ember/tide/horizon + gold, aurora + rose/moonstone) = 30 | PASS | `spec:340-346, :371-387`; scene/accent seeded through `ptah-scene`/`ptah-accent` (`:201-202`), asserted on `<html>` (`capture:67-68`) |
| Reduced transparency via CDP `Emulation.setEmulatedMedia` (A7) | PASS | `spec:325-337`; `matchMedia` verified true before capture |
| Narrow 400px via `setViewportSize` (A4) | PASS | `spec:287-298` with `NARROW` |
| Matrix total 116 = 80 + 4 B1b + 2 + 30 | PASS | counted per describe block; matches the addendum totals and the context.md B1b decision |
| No wall-clock waits; deterministic data | PASS | no `waitForTimeout` anywhere; fixed `CHECKED_AT`, `CLAUDE_PATH`, `CLAUDE_VERSION` |
| Harness imports nothing from `@ptah-extension/onboarding` | PASS | imports are Playwright, harness helpers and node builtins only |

### Independent validation of the two capture-fix selectors

- **Accounts tab** (`spec:234-237`): `getByRole('dialog', { name: 'Claude (Subscription) connection details' })`
  matches the drawer's `[ariaLabel]="(name ?? 'Connection') + ' connection details'"`
  (`connection-detail-drawer.component.ts:61-62`); the tab group is inside the dialog and a
  sibling of the `connection-detail-drawer` header testid, exactly as the fix report states.
  Fix confirmed correct.
- **Credentials commands** (`spec:313-314`): `[data-testid="credentials-cli"] > div > code`
  selects only the two `@for` command-row divs; the explanatory `Run <code>` sentence lives
  inside a `<p>` (`credentials-tab.component.ts:137-146`) and is excluded. The expected values
  match `commands` at `:416-418` and the core constants `'claude'` and
  `'npm install -g @anthropic-ai/claude-code'` (`claude-code-commands.ts:13-17`). Order
  (login before install) matches. Fix confirmed correct.

### Literal cross-checks (spec vs production)

- Chip labels `Checking` / `Ready` / `Not installed` / `Not signed in` / `Could not check` —
  match `ready-claude-step.page.ts:72-81`.
- State sentences (timeout 30 s, unreadable, local-cause, "Checking your computer...") —
  match `ready-claude-step.page.ts:90-92, :422`.
- Strip words `Checking` / `Ready` / `Needs install` / `Needs sign-in` / `Could not check`,
  `Skipped`, `Done` — match `ready-strip.component.ts:33-37, :50-51`; the `li` carries
  `data-step` (`:91`), so the `li[data-step="N"]` selector is valid.
- Banner actions `Install Claude Code` / `Sign in` / `Check again` (Home) and `Fix Claude Code`
  (Settings) — match `claude-readiness-banner.component.ts:33-43, :122`.
- Action testids `ready-continue`, `ready-continue-anyway`, `ready-named-account-link`,
  `ready-area-tablist`, `ready-area-panel-providers`, `ready-area-panel-cli`,
  `ready-settings-step`, `onboarding-home` — all present in production markup.
- The `missing` sentence "No claude command was found." was not found by a literal grep of
  `libs/frontend/onboarding/src`, but the prior capture run passed all four `stage1-missing`
  tests with this assertion (only the 8 Accounts/Credentials tests failed), so the rendered
  text matches; the grep miss is a source-wrapping artifact.

## Five logic questions

1. **Does the harness capture the state it claims?** Yes. Every capture is preceded by
   assertions on `data-state`, chip text, banner action or strip word, all verified against
   production literals. A wrong state fails the run instead of being captured.
2. **Can a capture pass while the app is in the wrong state?** Only through F1 (axe labels
   after a timeout flip, image unaffected) and the latent F2. No path was found where the PNG
   itself shows an unintended state.
3. **Are failure paths exercised, not just the happy path?** Yes — `missing`, `signed-out`,
   all three error fixtures and the in-progress `checking` views are first-class capture
   targets, as the addendum's matrix requires.
4. **Are the fixtures valid at the app's boundaries?** Yes — ambient replies satisfy
   `isAmbientStatus`; `error-local` is a resolver so the transport failure is honoured;
   detect rows match the `AGENT_CONFIG_FIXTURE` row shape (`settings.fixtures.ts:139-155`).
5. **Does anything suppress defects?** The `?? ''` in F2 is the one suppressor found.
   Axe violations do not fail the run — that is the approved design (a violation is a
   finding; the gate stays unmet while one is open), not suppression.

## Decisions

- **Route assertions through host testids, not `page.url()`** — decision: correct, not a
  finding. Evidence: the Router runs on `MemoryPlatformLocation`, so the URL never changes;
  the addendum's "asserts the URL" is satisfied by asserting the visible route host testid
  (`ready-claude-step`, `ready-settings-step`, `onboarding-home`), with the
  `marketplace-routes.e2e.spec.ts` precedent. Reversible; documented in the spec header.
- **Strip words per state, not the addendum's summary phrase "Needs attention"** — decision:
  follow production. The production `ready-strip.component.ts` (approved in Part A) maps each
  state to its own word; the addendum phrase was a summary of that row. The harness asserting
  the exact production words is the stronger check. Reversible.
- **Approve despite no rendered evidence** — decision: this review approves the harness code
  only. The coordinator must rebuild the post-merge webview and rerun the 116 captures; the
  visual gate stays UNMET until then (b1c-capture-fix-report.md "Blockers").

## Limitations

- **No rendered evidence.** This lane was barred from build, e2e and screenshots. The
  coordinator is rebuilding and recapturing. This review does NOT claim a screenshot pass,
  and the B1c visual gate remains UNMET until the coordinator's run produces all 116
  captures plus their axe JSONs with no open violation.
- The two prior run failures (108 passed / 8 failed) come from the fix report; I did not
  re-run the suite. My approval of the two selector fixes rests on markup evidence, which
  is stronger than the run alone.
- I did not compare `onboarding-ready-capture.ts` line-by-line with its `settings-capture.ts`
  precedent (tool-call budget); the behaviour was checked directly against the addendum.
- The `installHost(..., 'electron', 'chat')` platform claim (`win32`) was not re-derived;
  it follows the `bootSettings` precedent the addendum names. The asserted credential
  strings are platform-independent, so no capture depends on it.
- `ptah_get_diagnostics` / `npm run verify` were not run in this lane; the implementer's
  scoped typecheck (fix report) is the recorded evidence, and no type error was visible in
  the three files on inspection.

## Files inspected

- Under review: `onboarding-ready.fixtures.ts`, `onboarding-ready-capture.ts`,
  `onboarding-ready-visual.e2e.spec.ts` (all read whole).
- Requirements: `implementation-plan.addendum-prereqs.md` (lines 806-945, 1040-1099 and
  grep hits), `context.md` (whole), `b1c-capture-fix-report.md` (whole).
- Production cross-checks: `connection-detail-drawer.component.ts` (`:55-95`),
  `credentials-tab.component.ts` (`:80-120`, `:137-146`, `:416-420`),
  `claude-code-commands.ts` (`:10-20`), `ready-claude-step.page.ts` (grepped literals),
  `ready-strip.component.ts` (`:33-51`, `:85-100`), `claude-readiness-banner.component.ts`
  (grepped literals), `onboarding-home.component.ts` (grepped testids),
  `ready-settings-step.page.ts` (grepped testids),
  `claude-ambient-status.service.ts` (`:105-130`),
  `marketplace.fixtures.ts` (grepped responder/rpcError lines),
  `settings.fixtures.ts` (grepped helper signatures and fixture rows).

## Score justification

8 (sound, 20% band), not 9-10: F2 is a real, if latent, assertion suppressor, and F1/F3
leave a small, documented determinism uncertainty in the checking captures. Not 5-6: every
requirement row in the addendum table is implemented and verified against production
literals and boundary validators, and both previously failing selectors are now provably
correct. The evidence separating this score from the band below is the byte-exact literal
match across chip, sentence, strip and banner action texts, and the markup-level
confirmation of both fixes.