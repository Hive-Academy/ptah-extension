# Code logic review — revision 8

Review family: codex (implementer family: Claude)

## Verdict

APPROVED — 8/10, scoped to the four described changes. No confirmed blocking, serious, or moderate regression found. The source-level paths support the requested behavior; missing runtime and cascade verification keep this below 9–10. No demonstrated regression warrants the 5–6 band.

## Findings

None.

## Evidence and scope

Paths below are relative to the worktree. Read the three changed component implementations, the native popover implementation, the relevant stylesheet rule, and targeted regression assertions. This is not approval of the entire stylesheet or every existing behavior in these components.

- **Dock keyboard handling:** `libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts:176` evaluates to null when docked and invokes the same handler when overlay is true. `:391` declares a void handler; all explicit returns are bare returns. Non-Tab keys leave immediately; empty tabbable lists and first/last wrap cases explicitly prevent Tab default at `:398`, `:403`, and `:406`. Compact-sheet dispatch remains direct at `:223`. No false return propagates from the tabbability predicate through the handler. The regression spec at `canvas-inspector-dock.component.spec.ts:292` dispatches cancelable Enter, Space and Tab events and checks defaultPrevented.
- **Related handlers:** text searches across `libs/frontend/canvas` and `libs/frontend/chat`, followed by the canvas-rail and session-inspector directories, found no remaining short-circuit keyboard/event bindings in those target directories. The broad search found click/nodeActivated bindings elsewhere; those are outside this keyboard defect.
- **Popover paint:** `apps/ptah-extension-webview/src/styles.css:2363` excludes the exact shell class. The child `popover-panel` at `libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:107` still matches and receives the rule's background and border. The shell itself declares transparent background at `:136`, with transparent native backdrop at `:142`. Other class names containing “popover” retain selector membership unless they also carry the excluded shell class. The additional :not raises specificity, so unchanged membership is not proof of an unchanged cascade everywhere.
- **Cache label:** `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-cache-tile.component.ts:113` emits “estimated” or the idle countdown; `:117` independently constructs the full accessible description, attached at `:42`. Expiry, remaining-percent clamping and idle lateness cutoff remain separate from the shortened string. The spec at `inspector-cache-tile.component.spec.ts:109` covers idle start, fire time and lateness cutoff.
- **Lane row:** `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/lane-usage-tile.component.ts:80` applies the reserved padding only to the inspector variant; `:395` supplies !pr-8. Status has a shrinking bounded container and truncated text at `:114`, a full title at `:115`, and the full run chip in the button's accessible name at `:459`. The table changes to auto width only in the compact variant at `:234`. Spec assertions at `lane-usage-tile.component.spec.ts:592`, `:615`, and `:678` cover these contracts.

## Five logic questions

1. **Silent failure:** docked keyboard default cancellation is removed at `canvas-inspector-dock.component.ts:176`; shell opacity is excluded at `styles.css:2363`. No new success-looking failure identified.
2. **Unexpected user action:** Enter/Space no longer receive cancellation from the aside; overlay boundary Tab still wraps at `canvas-inspector-dock.component.ts:403`. Synthetic event assertions do not establish real browser activation.
3. **Wrong-answer inputs:** long status text retains its full accessible name at `lane-usage-tile.component.ts:459`; missing idle time selects “estimated” at `inspector-cache-tile.component.ts:109`. Existing overdue idle announcements round up to one minute (`:17`, `:124`), explicitly expected by the spec at `:125`; the wording change does not resolve that existing discrepancy.
4. **Dependency failure:** popover API fallback keeps the shell displayed at `native-popover.component.ts:315`; positioning timeout/rejection falls back at `:285` and `:291`, with a bounded race at `:381`. The selector change does not alter these paths. No new asynchronous dependency is introduced by these edits.
5. **Unspecified requirement:** actual fit with long values at narrow widths and screen-reader behavior need runtime observation; the bounds at `lane-usage-tile.component.ts:114` and auto-width table at `:234` alone cannot establish visual fit.

## Could not check

- No tests, build, diagnostics, browser, or Electron checks were run, as requested. Inspected assertions are not passing-test evidence.
- Git diff was not run: the governing reviewer role prohibits git operations. Change attribution relies on the supplied descriptions and current files.
- No task-description.md, implementation-plan.md, batches.md, test-report.md or code-style-review.md was present in the discovered task directory. Read context.md and root CLAUDE.md; the instruction-file search found no additional covering directory instructions.
- Did not audit the entire global stylesheet or all three spec files end to end. Full CSS cascade, generated utility styles, browser default button activation, screen-reader output and narrow-layout rendering remain unverified.

