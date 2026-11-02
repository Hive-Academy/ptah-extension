# Code logic review — b1c round c (provider card a11y fix + harness edits)

## Verdict

**REVISE — 7/10.** The `nested-interactive` violation is genuinely resolved: the details
trigger is an empty native button, and the inline action and scope control are siblings, not
descendants. Pointer routing, keyboard order, focus return, hover affordance, and the harness
selector migration are all correct. One medium regression remains: the `pointer-events-none`
content layer kills two documented `title` tooltips, so the full text of truncated card
segments is no longer reachable with the pointer.

## Review family

- Reviewer: ollama-cloud (independent family).
- Implementers: codex (production card fix), claude (harness edits).

## Findings

1. **[medium] Dead `title` tooltips in the pointer-events-none content layer.**
   `libs/frontend/chat/src/lib/settings/providers/provider-connection-card.component.ts:76`
   sets `pointer-events-none` on the content layer. An element with `pointer-events: none`
   never becomes the hover target, so its `title` tooltip never shows. Two children carry
   titles as the documented fallback for truncated text:
   `provider-connection-card.component.ts:89` (`card-subtitle`, `[attr.title]="text"`) and
   `provider-connection-card.component.ts:101` (`used-for`, `[attr.title]="usedForText()"`).
   The template comment at lines 82-85 states the design intent: "A segment cut at the row's
   full width keeps its whole text in its title."
   Failure scenario: at a narrow width the provenance segment truncates. The user hovers it
   to read the full text. The hit target is the details trigger, and the browser shows the
   nearest titled ancestor — the card status copy on the `ptah-native-card` host
   (`provider-connection-card.component.ts:72`) — instead of the segment text. The full text
   is unreachable from the card face (the drawer is the only remaining source). The same root
   cause also disables text selection on the card face, which worked before this change.
   A fix needs a decision, not a one-line patch: `pointer-events-auto` on those spans would
   stop those areas opening the drawer. Options: give the spans `pointer-events-auto` and
   accept a smaller click surface; move the full text into the visible layout; or drop the
   titles as dead attributes. Coordinator to settle with the design owner.

2. **[low] Keyboard activation of the trigger has no genuine automated coverage.**
   `provider-connection-card.component.spec.ts:80-86` dispatches `keydown` (which now hits no
   handler) and then calls `.click()` explicitly; the comment at line 81 admits jsdom cannot
   synthesize native button activation. The `toHaveBeenCalledTimes(3)` assertion counts the
   three explicit clicks, so the test would still pass if Enter/Space stopped working. The
   old test exercised a real custom keydown handler. The e2e harness also never presses Enter
   or Space on the trigger (all migrated call sites click). The risk is low because the
   trigger is a native `<button type="button">`, and one e2e keyboard press on the trigger
   would close the gap.

No findings against Change 2 (harness edits). Every `[role="button"]` and provider-name click
in the harness was migrated to the trigger testid; no stale reference remains (search across
`libs/frontend/webview-e2e-harness/src`), and the external consumers of the kept card testid
(`apps/ptah-electron-e2e/src/showcase/settings-tour.scene.ts:219`,
`docs-screenshots/workspace-settings.shot.ts`) only locate or spotlight the card, never click
by role.

## Checks passed

- **No focusable descendant inside an interactive element.** The trigger
  (`provider-connection-card.component.ts:74-75`) is an empty `<button type="button">`; the
  inline action (lines 125-131) and `ptah-setting-scope-row` (line 134) are siblings inside
  the content layer, never inside the trigger. The unit spec pins this
  (`provider-connection-card.component.spec.ts:95-97`: `surface(fixture).contains(action)` is
  false; line 276: trigger does not contain the scope badge).
- **Trigger geometry.** `ptah-native-card` renders its root `<div>` as
  `relative ... overflow-hidden rounded-xl border`
  (`libs/frontend/ui/src/lib/native/card/native-card.component.ts:108-109`), so the trigger's
  `absolute inset-0` resolves against that root and covers exactly the card. Paint order puts
  the trigger (z-0, later in DOM) above the decorative spine (z-auto, earlier,
  `native-card.component.ts:120-127`), and the content layer (`relative z-10`) above the
  trigger, so clicks pass through the `pointer-events-none` layer to the trigger everywhere
  except on the `pointer-events-auto` action and scope controls.
- **Action isolation.** A click on the inline action bubbles to the native-card root, whose
  `onClick` returns early because `interactive()` is false
  (`native-card.component.ts:218`); the action's own handler emits only its output. Covered
  by `provider-connection-card.component.spec.ts:90-103` and 315-325 (Retry emits
  `keyRetryRequested` only) and 273-284 (scope badge actions never emit `detailsRequested`).
- **Scope popover escape.** `ptah-setting-scope-row` opens through
  `NativePopoverComponent`, whose open shell is a `popover="manual"` top-layer element
  (`libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:88-96` and styles).
  The card root's `overflow-hidden` and the new z-0/z-10/z-20 stacking cannot clip or bury
  it; the badge itself is reachable because the scope-row host carries `pointer-events-auto`
  (`provider-connection-card.component.ts:134`).
- **Keyboard order and naming.** DOM order is trigger, then inline action, then scope badge,
  so tab order is trigger → action → scope. The trigger is named by `cardAriaLabel()`
  (spec assertion at `provider-connection-card.component.spec.ts:106-109`), and Enter/Space
  come from native button semantics. The focus-visible ring is drawn inside
  (`-outline-offset-2`), which is the correct choice: the outer-offset ring would be clipped
  by the root's `overflow-hidden`.
- **Focus return.** `providers-settings.component.ts:1166-1169` now targets
  `[data-testid="provider-card-details-trigger"]`; the settings spec asserts
  `document.activeElement` is that button after a card check
  (`providers-settings.component.spec.ts:940-942`).
- **Test coverage kept.** Card-area click, action isolation, accessible names, key-unreadable
  Retry (spec:294-325), scope-badge activation (spec:268-285), layout, and tone tests all
  survive; only the button-count expectations changed (0→1, 1→2) to count the new trigger.
  Finding 2 records the one coverage caveat.
- **Hover affordance and attributes.** The removed interactive classes are replaced by
  `[&>div]:hover:bg-base-200/70 [&>div]:hover:border-base-content/20`
  (`provider-connection-card.component.ts:70`), which compile to `class > div:hover` on the
  native-card root; hovering any descendant (the trigger included) still lights the card.
  `data-tone` stays on the root (`native-card.component.ts:116`), `data-state` and the
  status `title` stay on the host (`provider-connection-card.component.ts:72-73`).
- **Harness click position.** `{ position: { x: 12, y: 12 } }` on the trigger lands 12px
  inside the card padding box, over no inline control (controls sit on the right edge) and
  past the 4px spine; the point is the centre of the 12px corner arc, so it is inside the
  trigger. The hit target is the trigger itself because everything above it there is
  `pointer-events-none`.
- **NARROW viewport arithmetic.** `ptah-sidebar-tab` is `w-8` (32px) at default size
  (`libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts:63`). The shell renders two
  tabs: Workspaces (left, `electron-shell.component.ts:431`) and Git (right,
  `electron-shell.component.ts:491`, unconditional). The workspace sidebar and editor panel
  default to hidden (`libs/frontend/core/src/lib/services/electron-layout.service.ts:75,77`)
  and the harness page has no persisted layout state, so the body is
  32 + content + 32. The content host holds `min-w-[400px]`
  (`electron-shell.component.ts:445`). 464 − 64 = 400, which matches design-spec §12.8
  (`design-spec.md:461`, narrow case at 400px). Electron `minWidth: 800`
  (`apps/ptah-electron/src/windows/main-window.ts:124`) is the real-window floor; 464 is a
  capture-only emulation below it, which is the point of the harness. Confirmed: the
  onboarding harness renders the real shell (`onboarding-ready.fixtures.ts:229` waits for
  `ptah-electron-shell`).

## Limitations

- Read-only review: no tests, builds, browsers, or e2e were run, per the task rules. The
  400px content area and the (12,12) hit target are verified statically (source, Tailwind
  class semantics, defaults); the coordinator's capture run is the rendered confirmation.
- A page-level classic scrollbar would reduce the layout width below 464; the shell body is
  `overflow-hidden` and scrolling happens inside panes, so this should not apply, but only
  the capture can prove it.
- The unit keyboard caveat in Finding 2 is inherent to jsdom; I did not verify whether any
  non-Playwright runner synthesizes button activation.
- I reviewed the diff and the whole current files listed in the task; I did not audit other
  `NativeCardComponent` callers, which this change intentionally does not touch.

## Re-review (revision 1)

**Verdict: APPROVED — 8/10.** Finding 1 is resolved. The details trigger now carries
`[attr.title]="triggerTitle()"`
(`provider-connection-card.component.ts:75`, computed at `provider-connection-card.component.ts:283-287`),
which exposes the status copy, the subtitle, and "Used for: …" on hover of the card face.
The revision introduces no behavioural defect; one low cleanliness note remains.

### Resolution check — Finding 1 (tooltip regression)

- **Full segment text is reachable again.** Hovering anywhere on the card face targets the
  trigger (the content layer is still `pointer-events-none`), and the browser shows the
  nearest titled element, which is now the trigger itself, with the joined multi-line
  title. This restores the documented affordance the template comment names
  (`provider-connection-card.component.ts:84`).
- **No blank-line defect.** `subtitle()` returns `sourceLabel() || … || authModalityLabel()`,
  and `authModalityLabel` returns `null` for `null` and `''`
  (`provider-connection-card.state.ts:214-217`); every other operand is a non-empty literal.
  So the filtered array never contains an empty string, and `join('\n')` cannot produce a
  blank line. The spec pins both branches: the joined title with all three parts and the
  no-segments case, which reduces to the status line only
  (`provider-connection-card.component.spec.ts:114-127`).
- **No screen-reader confusion.** The trigger has both `aria-label` (accessible name) and
  `title` (hover text). The accessible-name computation gives `aria-label` precedence, so
  `title` is ignored for naming and serves pointer users only; no duplicated announcement.
  The old test's name assertion (`cardAriaLabel()`) still passes unchanged
  (`provider-connection-card.component.spec.ts:106-109`).
- **Tooltip covering.** The title is a native OS tooltip anchored at the cursor, as before;
  the extra lines only lengthen it. No new overlay or clipping risk.
- **Host title consistency.** The `ptah-native-card` host keeps its status-only title
  (`provider-connection-card.component.ts:72`), which now surfaces only over the inline
  action and scope controls (the trigger's own title wins on the card face). That matches
  the pre-fix behaviour over those controls.

### Spec change check (coordinator)

- The btn-sm rule is not weakened. The "native btn-sm controls" test still requires every
  button outside `nodeAction` and `cardTrigger` to be `btn-sm`, not `btn-xs`, and to carry
  `focus-visible:outline-2` (`providers-settings.component.spec.ts:983-987`). The card's
  inline action stays inside that loop (`cardAction` true, `cardTrigger` false), and the
  test still demands at least one such card action (`providers-settings.component.spec.ts:980`),
  so the exclusion cannot hollow the rule out. The excluded triggers get their own
  assertions: `inset-0` and `focus-visible:outline-2` per trigger
  (`providers-settings.component.spec.ts:981-984`), matching the stretched-target precedent
  of the routing-node action.
- `toHaveLength(2)` is correct for that fixture: the route seeds exactly two providers
  (`providers-settings.component.spec.ts:965`), each card renders exactly one details
  trigger, and the catalog modal is filtered out; the coordinator's passing run confirms.

### Findings (revision 1)

1. **[low] Unreachable duplicate `title` attributes remain on the content spans.**
   `provider-connection-card.component.ts:89` (`card-subtitle`) and
   `provider-connection-card.component.ts:101` (`used-for`) still bind their own `title`
   attributes, but their `pointer-events-none` layer means they can never be hovered, so
   these titles can never display. The same text now lives in `triggerTitle()`. Failure
   scenario: none at runtime today; the risk is silent divergence — a future edit changes
   one source, the specs pin only the trigger title, and the dead attributes mislead the
   next reader into thinking the spans still carry their own tooltip. Delete them or point
   a comment at `triggerTitle()` in a later cleanup; not a merge blocker.

### Residual

Finding 2 (jsdom cannot exercise real Enter/Space activation on the trigger; no e2e presses
them either) stands as accepted by the coordinator. The trigger is a native
`<button type="button">`, so the risk stays low.

### Limitations (re-review)

- Read-only re-review per the task rules: no tests, builds, browsers, or e2e were rerun. I
  relied on the coordinator's evidence (34 suites / 973 tests, typecheck, lint, 115/115 axe
  reports with zero violations, narrow 464px captures without clipping) and verified the
  revision statically in source and specs.
- The one failing contrast-sweep case (route.fetch ECONNRESET from the local fixture server)
  is infrastructure noise outside this diff's scope; the rerun result was not available to
  me.