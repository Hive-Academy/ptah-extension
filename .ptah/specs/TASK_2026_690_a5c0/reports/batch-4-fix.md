# Batch 4 fix round — display sheet

## Findings and fixes

| Finding | Fix | Coverage |
| --- | --- | --- |
| S1: size container offsets fixed composer menus | Removed `container-type: size` from `chat-session-layout.component.ts:12`; the sheet now uses the session's flex column. | `chat-session-layout.component.spec.ts:88` checks every composer ancestor for size containment. |
| S2: full mode pushes the composer away | `display-sheet.component.ts:21-25` gives peek a 40% flex basis and full a 100% shrinking flex basis. The region fills the remaining sheet height; the transcript yields space to the sheet while the controls and composer remain later fixed-size flex items. | `chat-session-layout.component.spec.ts:101` checks full sizing and composer order. Rendered geometry remains unverified. |
| S3: summary errors and moved dock roles | `display-sheet.component.ts:145` shows the service's `Error.message`, with the existing fallback for other failures. Sheet bindings and action outputs remain wired at lines 55-59 and 131-145. | `display-sheet.component.spec.ts:95,125,193,228` covers surface, pin, view state, summary, selection mapping, file/review actions, missing change set, service error, per-tab restore, and axe. |
| M1: direct open does not scroll on first mount | `display-panel.component.ts:268,338-346` adds an opt-in initial scroll; `display-sheet.component.ts:57` enables it for an explicitly selected surface. The default preserves the panel's mount-time no-scroll behavior. | `display-panel.component.spec.ts:279` checks requested initial scroll and focus; existing pin/mount tests remain. |
| M2: collapse discards renderer state | `display-sheet.component.ts:50-53,86,113` keeps the region and panel mounted after first open, then hides and makes it inert when closed. | `display-sheet.component.spec.ts:95` checks the same panel instance on reopen; `chat-view.dock.spec.ts:574,613` now expects a hidden retained region. |
| M3: tab switch pulses old content | `display-sheet.component.ts:88-111` seeds the revision when the visible tab changes and ignores queued pulses from the prior tab. | `display-sheet.component.spec.ts:161,179` checks no pulse on tab visits and a pulse for a visible-tab update. |
| M4: inner Escape collapses the sheet | `display-sheet.component.ts:53,124-128` collapses only when an inner handler has not prevented Escape. | `display-sheet.component.spec.ts:212` checks a prevented inner Escape. |

The new panel input was added to the sheet's test stubs in `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`, and the owned Canvas transcript spec so their Angular bindings match the production panel.

## Verification

- `chat-view.component.ts` remains **2041 lines** (before and after this fix round), within the 2041-line limit.
- Tree-sitter parsing returned `ok` for the sheet component and spec, layout spec, and panel component.
- Scoped `ptah_get_diagnostics` returned unavailable after 45 seconds with the TypeScript check still running. Tests, typecheck, lint, build, and rendered checks were not run, as instructed.

## Decisions

- **Use flex basis for sheet height.** Options: size containment with container units, a ResizeObserver, or flex sizing. The session is already a bounded flex column, and the composer must stay outside a size containing block; flex sizing is the simplest reversible choice.
- **Keep the panel instance after its first open.** Options: keep it mounted but hidden or serialize renderer-local state. The existing view-state store already persists data, while a hidden/inert region preserves transient scroll and renderer state. Reversible if a later memory policy requires serialization.
- **Scroll only on an explicit mount request.** Options: always scroll on mount or add an input. The panel's existing mount and pin assertions require the default no-scroll behavior; the sheet supplies the request only for a selected surface. Reversible.

## Not done

- No test or browser run was permitted. The flex geometry and Floating UI positioning need a rendered pass in the later verification stage.
