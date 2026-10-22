# Theme dropdown — independent source review

## Review family

- Implementer: Grok CLI, lane 6fd429e2-a93a-49f7-a94b-c96d0bf5142c.
- Reviewer: OpenAI, parent session. Different family, independent source review.
- Scope: theme-toggle.component.ts and theme-toggle.component.spec.ts diff against current HEAD b55e4d797. Inherited CI revisions are not accepted by this review.

## Verdict

Source review: no blocking defect identified. Runtime acceptance remains INCOMPLETE.

No tests, diagnostics, lint, build, serve, E2E, or screenshots ran. This review does not establish that the original visibility failure is fixed in Electron. Do not merge on this evidence alone.

## Evidence

- Native button targets a unique popover ID at theme-toggle.component.ts:41-57. Native auto popover supplies browser-managed toggle, Escape, and light dismissal in supported Chromium hosts.
- Open panel uses the browser top layer. Component CSS overrides DaisyUI position, opacity, visibility, and transform at :26-36. Native closed popovers remain absent from layout.
- beforetoggle handles opening coordinates and reflects state through a signal at :193-205. A real browser event, not the synthetic unit event, must verify this path.
- Theme groups still use the unchanged DAISYUI_THEMES filters at :179-180. Row selection, selected checkmarks, and three glass accent controls remain.
- Persistence write path is unchanged: selectTheme -> ThemeService.setTheme and selectAccent -> ThemeService.setAccent at :185-189. No storage keys, formats, scopes, or service side effects changed.
- Spec checks target linkage, 36 rows, synthetic opening coordinates, aria-expanded, theme delegation, and accent delegation. It does not test actual top-layer visibility, click toggling, Escape, outside click, focus restoration, or closed-state aria-expanded.
- Status inspection shows the lane added changes only to the two component files and its report. Existing pending revisions and unrelated .gitignore remain present. No commit or push occurred.

## Findings and limits

1. The source-cause narrative in theme-dropdown-fix.md:7-15 and the component CSS comment are stronger than the evidence. A 40px flex item does not itself clip overflow. A viewport-sized overflow-hidden ancestor does not prove that this header menu was clipped. The old tabindex trigger normally accepts focus. No computed styles or original hit-test capture establish which mechanism caused the reported failure. Treat focus, clipping, and stacking as hypotheses, not a confirmed root cause.
2. The top-layer placement samples the trigger only when the panel opens. It does not reposition or constrain panel height after a window resize. This review found no evidence that this newly breaks an accepted use case, but Electron visual verification must include a small window and resize.
3. The new test title says it opens the list in the top layer, but jsdom only verifies attributes and a synthetic event. Do not cite it as rendered proof even if it passes.

## Required acceptance evidence

When the user authorizes local execution, verify actual Electron dark and light themes: mouse and keyboard opening, visible panel, row hit testing, theme and accent selection, outside dismissal, Escape, focus return, small window, and resize. Run only the focused spec or changed-project checks under the shared heavy-check rules. The temporary no-local-check policy remains in effect.

No additional author/reviewer correction cycle started. The exhausted CI correction budget remains unchanged. The requested tabbed redesign is not implemented or accepted by this review.
