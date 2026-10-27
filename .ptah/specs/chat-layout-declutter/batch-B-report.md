# Batch B — Inspector API and state

Implemented the compact inspector rail and expanded identity surface within Batch B ownership. Required verification was attempted once but did not complete before the tool-call ceiling. This is NOT a verified-pass handoff.

## Files changed

All source paths below are relative to `D:/projects/ptah-extension/.claude-worktrees/chat-layout-declutter/`:

- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.ts`
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.html`
- `libs/frontend/chat/src/lib/components/organisms/session-inspector/session-inspector.component.spec.ts`
- `libs/frontend/chat/src/lib/services/session-inspector/inspector-open-state.service.ts`
- `libs/frontend/chat/src/lib/services/session-inspector/inspector-open-state.service.spec.ts`
- `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.ts`
- `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock-width.spec.ts`
- `libs/frontend/chat/src/lib/services/session-inspector/inspector-dock.controller.spec.ts`

The controller and width store production implementations remain suitable: presentation changes do not write the saved resize preference. The rail width constant is now 56px. No canvas imports, git operations, unrelated file edits, or new dependencies.

## Public API for Batch A

Use the existing exported `SessionInspectorComponent` / `ptah-session-inspector`.

Inputs:

- `selectedAgentKey: string | null | undefined = undefined`: forwards canvas's existing selected lane key (`cli:<id>`, `sub:<id>`, `bg:<id>`) unchanged to the agents section. Undefined preserves Batch D's standalone selection fallback; explicit null clears host selection.
- `tabId: string` (required), `hasLaneSurface: boolean = false`, `stats: SessionStatsInputs | null = null` retain existing contracts.
- `presentation: 'docked' | 'sheet' | 'embedded' | 'rail' = 'docked'` adds rail. Rail renders its own 56px aside; replace it with expanded presentation, never render both alongside one another.
- `sessionTitle: string = ''`: full wrapping identity title.
- `sessionStatus: string = ''`: passive status text.
- `workflow: string | null = null`, `branch: string | null = null`: optional wrapping metadata.
- `focusSection: 'session' | 'agents' | 'todos' | null = null`: retain the expansion target in the canvas host and pass it into the expanded/remounted instance. The inspector focuses that section after rendering. If that section is unavailable, focus goes to the compact/close control.

Outputs:

- `expandRequested: 'session' | 'agents' | 'todos' | undefined`: top expand control emits undefined; Ctx/Tok/Cost/Time emit session; Run emits agents; Todo emits todos. Host updates its existing boolean and passes the target to focusSection. No request-priority focusing.
- `closeRequested: void`: expanded compact control requests collapse; sheet close preserves existing close semantics. Canvas must return to compact rather than hidden.
- `laneRequested: string` and `answerRequested: string`: unchanged forwarding.

Content slots:

- `[inspectorActions]`: session actions, immediately below expanded identity metadata.
- `[inspectorSection]`: existing avatar-strip slot retained. Batch A owns mutually exclusive projection/rendering and selected-agent store state.

Focus:

- Switching presentation on the same instance from expanded to rail focuses the expand control automatically.
- Public `focusExpandControl(): void` focuses the rendered expand control. When Batch A destroys/remounts inspector instances, invoke this on the new rail after rendering to restore focus.
- Rail expand control carries `data-inspector-expand`; existing expanded control retains `data-inspector-close` for the sheet controller.

State/width services (unchanged method signatures):

- `InspectorOpenStateService.dockedOpen(tabId, mode, initialOpen): boolean`; true = expanded, false = compact wherever the rail is eligible. Existing default and per-tab/per-view-mode retention are preserved.
- `setDocked(tabId, mode, open): void`, `forget(tabId): void`. Tab closure clears the choice. Overlay state continues to belong to the existing host controller.
- `InspectorDockController.bind(shown, availableWidth)`, `width`, `maxWidth`, `minWidth`, `slotShown`, `preview`, `cancel`, `commit`, `reset` retain their contracts. Bind shown to expanded dock visibility; do not feed rail width into preview/commit.
- `InspectorDockWidthStore.preference`, `commit(width)`, `reset()` retain existing localStorage behavior and bounds.
- Existing exported `INSPECTOR_TAB_WIDTH` is now 56. Subtract either the compact rail or the expanded dock in canvas accounting, never both.

## Verification

- Required command launched ONCE at the worktree root: `npm run verify -- -p @ptah-extension/chat`, with output tailed to 65 lines and exit status preserved.
- Completion result: INCOMPLETE. The attached foreground command (execution session 52196) still had no completion result after the single 300-second completion check. Near the tool-call ceiling, its exact PowerShell process and child tree were terminated (PIDs 36800, 9104, 25528, 22596), rather than leaving verification running in the background. No test pass/fail result was obtained; coordinating verification is required.
- Scoped `ptah_get_diagnostics`: no diagnostics in requested changed component, component spec, state spec, or width policy. It reported 253 sibling diagnostics outside ownership, including fixture type errors in agent-card, compact-session, execution, and transcript specs. No unrelated fixes attempted.
- New regression coverage: retained expanded/compact choice and tab cleanup; 56px rail width independent of expanded defaults; saved resize preference across compact transitions; unknown rail values and omitted absent fields; expansion target events and accessible attention count; section focus and collapse focus return; wrapping identity and retained expanded sections.

## Decisions

- Batch D integration follow-up: read `batch-D-report.md` and verified all agents-section inputs. Added optional `selectedAgentKey` passthrough; existing `tabId`, complete `agents` rows, `sessionId`, `hasLaneSurface`, and `staggerStart` bindings already satisfy the handoff. No Batch D files changed. Canvas remains selection owner. Reversible.
- Retain the existing per-tab/per-mode in-memory boolean rather than add localStorage persistence. Evidence: inspector-open-state.service.ts explicitly defines in-memory lifetime and clears on tab close; the request says persist like today's open state. Width remains separately localStorage-backed. Reversible.
- Reuse `compactSessionMetrics(stats)` from Batch C, mapping only its Tokens caption to the approved Tok rail label. No metric arithmetic was introduced. Reuse existing `summarizeTodos` for the optional Todo tile and existing inspector model active/attention counts. Evidence: batch-C-report.md API and existing todos section. Reversible.
- Use identity text inputs plus `[inspectorActions]`, preserving `[inspectorSection]`. Evidence: approved composition boundary keeps canvas out of chat and delegates session actions/strip to Batch A. Reversible.
- Preserve existing state/controller public method names for other hosts. False means compact in the canvas composition; narrower hosts retain their existing sheet entry conditions. Evidence: responsive rules and shared host consumers. Reversible.
- Use existing `state-need` token for the attention badge, verified in the Electron webview Tailwind theme and nearby agents section. Reversible.
- Focus through a typed section input after render, with public focusExpandControl for host-controlled remounts. Evidence: canvas owns expansion and may mount separate branches; component cannot focus a new sibling instance itself. Reversible.

## Not done / boundaries

- Canvas mounting, narrow-sheet routing, projected actions/strip wiring, and host focus restoration across remounts belong to Batch A.
- Active-agent row changes belong to Batch D; existing section placement, inputs, and outputs were preserved.
- No Electron screenshots or host-wide checks were run; only the mandated chat verification was launched. Cross-host compilation is not certified by scoped diagnostics.

- Required verification remains incomplete. New tests have not been confirmed passing. The run was stopped at the tool budget; no build, serve, or e2e command was substituted.


Batch D passthrough follow-up verification: scoped ptah_get_diagnostics returned no diagnostics in session-inspector.component.ts, with the same 253 sibling errors. The mandatory verification run was not repeated; its incomplete status above remains unchanged.
