# Glass UI repair — independent source review

Author: Grok CLI 79ab1a1d-6747-4cd1-8cb9-65b801e41779.
Reviewer: OpenAI parent session. Different family, independent source review.

## Scope

Only the new shell-background replacement and answer-card padding in styles.css, plus their new source guard in glass-roles.spec.ts. This does not approve the inherited pseudo-layer, error-ink, axe, license-card or marketplace corrections. It does not cover the shared popup or selector redesign phases.

## Verdict

No blocking source defect identified in these two corrections. Rendered acceptance is INCOMPLETE. No test, lint, typecheck, diagnostics, build, serve or screenshot ran.

## Findings

- The old unlayered selector cleared every bg-base-100/bg-surface-0/bg-surface-1 background. The custom sessions panel and header use those classes without a matching glass restorer (`previous-sessions-modal.component.html:22,30`). The new shell-only selector no longer matches either element. Ordinary reading backgrounds survive while later explicit role overrides continue to control glass surfaces.
- Both assistant answer paths use `.cs-answer[data-glass-surface="content"]` with no horizontal inset (`message-bubble.component.html:71-75,95`). The glass-only padding adds the existing sidebar spacing values. Non-glass padding does not change.
- The new source assertions are not browser tests. Their exact-string rejection would not detect a differently written blanket transparency rule. They provide a narrow regression guard, not proof of computed opacity or dimensions.
- The padding shorthand overrides conditional `pt-4` on answers with a disclosure/log. This is intentional according to the author report, but disclosure-to-card spacing needs Electron review. Do not claim the screenshot's large gaps are fixed: transcript gap and timestamps were not changed.
- Other bg-base-200/300 overrides and overlay pseudo paint remain. This correction does not establish that all popups/modals are now correct. The custom sessions scrim and generic modal scrim also need rendered inspection for double dimming.
- Theme tokens, persistence APIs, accent eligibility and all 36 themes remain unchanged. No write-path change occurs.

## Acceptance still required

With explicit execution authorization, inspect Previous sessions, assistant answers with/without logs, composer, and nested overlays in Electron dark/light modes. Compare the reported defects against the new render. Validate backdrop hit testing, focus, small viewport bounds, non-glass appearance and C4 parity separately. Preserve the shared heavy-check slot rules.
