# Theme picker design — independent parent review

Author: Grok CLI ee5caba6-191a-429a-939a-8d50c7bb6e47.
Reviewer: OpenAI parent session, independent source review. No Agent/Task subagent.

## Verdict: APPROVED for implementation by independent source review

Revision b1b27650-1dff-4c50-934d-67d958fd58aa corrects the six requested source/design items. Panels now inherit stage tokens, tabs have controlled/labelled panel relationships, requirement tags distinguish proposals, outside focus is preserved, used columns drive grid movement, and placement caps height against available space. The parent accepts these reversible design decisions for the requested selector implementation. No capability removal is authorized.

This is a source-level document gate, not rendered visual acceptance. The temporary no-execution restriction prevents Electron prototype screenshots. Record that weaker evidence explicitly. Production visual acceptance and merge remain blocked until authorized Electron verification. Implement initial focus after the open render, not synchronously before Angular creates the selected category's tiles.

The classification and parity plan match the requested scope: Light 18, Dark 12, Glass 6, derived from existing metadata. All 36 themes, ThemeService delegation, accent eligibility and trigger name remain. No removal is approved or proposed.

## Required corrections before implementation

1. Prototype panels lose their mode tokens. `theme-picker-prototype.html:329` appends each panel to document.body, outside `.stage.dark` / `.stage.light`, where `--ink`, `--overlay`, `--line`, and other panel tokens are defined (:45-80). Panel color/background declarations therefore have unresolved variables. Keep panels inside their owning stage (native top-layer promotion preserves inheritance) or explicitly provide every required token on the panel. This is a source defect, not a rendered observation.
2. Tab semantics need a complete relationship. Prototype tabs do not set `aria-controls` (:346-359), despite the design requirement. The controlled content has role=group, not tabpanel (:361-364). Use stable tab IDs, aria-controls and a matching role=tabpanel with aria-labelledby for the active category. Keep the buttons and their accessible names.
3. Correct attribution of requirements. Roving tab/tile focus, exactly-once partition and no-alphabetical-sort are implementation/design decisions, not direct user requests. Tag them designer-proposed or project-rule with a real source. Retain the sensible decisions, but do not invent user instructions.
4. Correct focus expectations. Native auto-popover outside dismissal does not justify unconditional focus return to the trigger after the user clicks another focusable control. Require Escape focus restoration when focus was in the panel. Preserve outside focus on the clicked control. The prototype already does not restore focus for outside pointer (:512-515). Align the design and acceptance evidence.
5. Correct tile column count. A 16rem panel with 6px padding and 36px tiles plus 6px gaps fits five columns, not six. Derive vertical keyboard movement from used columns, as the prototype does. Do not hard-code six.
6. Constrain vertical placement when neither above nor below fits. A viewport-relative max height alone does not guarantee an anchored panel stays in the viewport. Specify usable height/position clamping and resize updates. Preserve the 4px preferred anchor gap when space permits.

## Accepted proposed details, subject to corrections

- Metadata-based categories and existing order.
- Compact four-color tiles, title and aria-label, selected check and separate focus indicator.
- Shared accent footer while either Ptah theme is current.
- Full-ink tab labels and existing tokens, with no service/storage changes.
- Native auto-popover in production, with local positioning and resize bounds.

## Evidence limits

No prototype or app was rendered. Contrast figures in the design are author claims, not independently measured acceptance evidence. Source review cannot prove visibility, clipping, hit testing or light/dark parity. The document gate is approved at source level only. Electron visual review remains required before merge.
