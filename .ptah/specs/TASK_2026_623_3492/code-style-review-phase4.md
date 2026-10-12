## Code-style review — Phase 4 (Batches 16–21)

**Score: 7/10** — structurally sound lazy/eager separation and Angular conventions, with one serious public-API staging inconsistency. This clears the 5–6 band because the affected code otherwise uses standalone OnPush components, `inject()`/signals, type-only eager imports, focused ports, and no chat-to-chat-ui inversion. It does not reach 8 because the public secondary-entry surface directly contradicts the intended eager-safe import route and makes the documented bundle boundary easy to bypass. It is not a 9–10 review because that tier requires an exceptionally unambiguous, misuse-resistant public boundary.

Scope examined: `git diff b66148f4c..5f356dc96`, all changed production files in `libs/frontend/chat-ui`, `libs/shared/src/mcp-apps-contracts/surface.index.ts`, and `tsconfig.base.json`; root `CLAUDE.md`; `implementation-plan.md`; and decisions #37a and #52–#90. Closest comparisons included `chat-ui/src/change-set-card.ts`, `chat-ui/src/mermaid.ts`, `chat-ui/src/lib/services/ptah-ui-host-sources.ts`, and `chat-ui/src/lib/services/ptah-ui-live-window.ts`. No build, test, lint, Nx, Jest, or typecheck command was run, per the memory-safe instruction. `git diff --check` produced no whitespace errors. The diagnostics tool was intentionally not invoked because this is a reading-only review and the task prohibits typechecking.

## Blocking

None.

## Serious

- `libs/frontend/chat-ui/src/ptah-ui.ts:25` exports `PTAH_UI_DISPLAY_DOCK`, `displayFenceKey`, and the dock port/status types from the lazy `@ptah-extension/chat-ui/ptah-ui` entry. This conflicts with the entry’s own statement that an eager provider needs the main-barrel export (`ptah-ui.ts:17-21`) and with decision #59, which intentionally defers the main-barrel export to Batch 23 so ChatView can import the eager-light file without importing a lazy entry. The current export creates a second, tempting public route to the same token; a later eager caller can accidentally pull the `ptah-ui` lazy entry into the initial closure, precisely the boundary the entry comments and eager-closure gate protect. Remove this re-export now; Batch 23 should expose the port, sync token, helper, and associated types only from `src/index.ts`, as its prescribed task states. Impact: preserves a single bundle-safe integration path and prevents an easy future eager-import regression.

## Moderate

None.

## Minor

None.

## Five style questions

1. **What breaks when requirements change in six months?** The duplicate dock-port route makes a future ChatView or host integration likely to import from `/ptah-ui`; that can silently defeat lazy loading. Apart from that issue, the read/write dock split in `ptah-ui-display-dock.ts:36-104`, optional host token in `ptah-ui-host-sources.ts:14-33`, and type-only `DisplaySurface` import in `ptah-ui-display-dock.ts:1-2` localize host changes well.
2. **What would a new team member misread here?** `ptah-ui.ts:17-21` says the dock port needs a main-barrel export, but `ptah-ui.ts:25-31` immediately publishes it from the lazy entry. That is contradictory guidance at the public boundary.
3. **What does this cost to maintain that a simpler shape would not?** Two supported-looking import paths require every future consumer to understand chunking history rather than follow one canonical import. One main-barrel port export, added in its planned batch, has no such ambiguity.
4. **Where is this inconsistent with how the same problem is solved elsewhere in the repo?** `PTAH_UI_HOST_SOURCES` follows the intended eager-port pattern: its eager-light service file is exported by `src/index.ts:103-106`. Lazy sibling entries `change-set-card.ts:12-17` and `mermaid.ts:1-2` expose their lazy component surface only. The display dock instead crosses those roles at `ptah-ui.ts:25-31`.
5. **What would you have done differently, and why is that better rather than merely other?** Keep `ptah-ui.ts` limited to the lazy renderer/chip/block API; leave `ptah-ui-display-dock.ts` internal until Batch 23 adds its main-barrel export. This preserves the staged plan (decisions #59, #60, #73, #76), gives eager code one safe entry point, and needs no new abstraction or configuration.

Positive evidence: `display-panel.ts:19-35` keeps display-panel exports confined to the lazy secondary entry; `surface.index.ts:158-162` exports the `$agents` input as types only, preserving D6’s eager restriction; `ptah-ui-block.component.ts:94-109` delays adapter resolution through the root token; and `ptah-ui-lane-limits.source.ts:43-60,129-157` has holder-bound lifecycle, timeout, guarded payload handling, and bounded push-driven recovery.

VERDICT: REVISE
