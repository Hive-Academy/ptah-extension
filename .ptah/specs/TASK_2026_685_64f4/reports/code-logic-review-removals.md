# Code Logic Review (removals phase) — TASK_2026_685_64f4, PR #751

Scope: b6d86b710 (B7a), 5a4932658 (B7b+B7c), 8fde7c7eb (B6a), 02419881c (B6b), and the conflict resolution of
canvas-lane-view.component.ts (+ spec) in d442593ec. Static review only; no tests, typecheck or lint run.

## Summary

| Metric   | Value    |
| -------- | -------- |
| Score    | 9/10     |
| Verdict  | APPROVED |
| Blocking | 0        |
| Major    | 0        |
| Minor    | 3        |

## Removal completeness (evidence)

- Repo-wide grep (excluding node_modules, .git, task folders) for `subagent:transcript`, `SubagentTranscript*`,
  `getSubagentTranscript`, `normalizeTranscript`, `renderMessageText`, `viewTranscript`, `canViewTranscript`,
  `TranscriptViewer`/`transcript-viewer` returns only: the intentional `host-source-registry.baseline.ts:361`
  entry (P4), `SubagentTranscriptProbe` / `probeSubagentTranscript` (Risk 11, still consumed by
  `chat-subagent-context-injector.service.ts:141`, specs intact), a negative assertion in
  `inline-agent-bubble.component.spec.ts:180`, and one stale doc comment (Minor 1).
- RPC chain is consistent: registry entry and `RPC_METHOD_ENTRIES` flag removed (`rpc.types.ts`), schema removed,
  `SubagentRpcHandlers.METHODS` (subagent-rpc.handlers.ts:92-99) and `register()` (:116-124) no longer list or
  register it, the `satisfies readonly RpcMethodName[]` guard would fail the build on a leftover. Dispatcher
  injection stays because `chat:subagent-query` still uses it. No other host registers its own method list
  (no hit in electron/cli/vscode apps).
- `subagent:history-page` handler (`registerHistoryPage`) is intact after the diff reshuffle; same params,
  coded `RpcUserError`s (`INVALID_PARAMS`, `HISTORY_CURSOR_STALE`, `PERSISTENCE_UNAVAILABLE`) preserved.
- UI: inspector menu `AgentTrayAction` is now `'steer' | 'background' | 'stop'`, and the dispatch switch in
  `inspector-agents-section.component.ts:507-514` has no leftover `'transcript'` case. App-shell overlay block,
  import, injection and the viewer service are all gone. Strip: field, menu button, `viewTranscript` output,
  icon and `hasActions` term removed together; all producers (`fromSubagent`, `fromBackground`, canvas lane view)
  updated. Steer, background, stop, D13 record-less strip (canvas-lane-view background fallback still renders
  `ptah-background-agent-strip` with the other flags) are preserved.
- `AgentMonitorStore.getSubagentTranscript` removed with its type import; chat-ui barrel no longer exports the
  viewer. No remaining caller.
- Runtime degradation: no frontend path can reach the removed RPC. A stale client would get the standard
  unknown-method error from the handler map; hosts ship together, so not reachable in practice. Sub-agent output
  now flows through `ptah-subagent-lane` + `subagent:history-page`.

## Merge resolution (canvas-lane-view.component.ts)

Compared main (d442593ec^2) with branch (d442593ec^1) and the result:

- Main's layout kept: host class `block h-full min-h-0` with `[class.overflow-hidden|auto]` bound to
  `selectedKind()`, panel `flex flex-col` only for the orchestrator, orchestrator wrapper `min-h-0 flex-1`,
  lane block `flex`/`hidden` toggled by kind, with `rail-lane-enter` animation retained.
- Branch's behaviour kept: `ptah-subagent-lane` fed `[record]`, `[sessionId]`, permission passthrough; shared
  `subagentLane` template for both `subagent` and `background` cases; the focus-on-open effect, opener restore,
  `back()` and `onEscape()` are intact and read `selectedKind()`.
- `effectiveCanvasLaneKind` vs old `selectedKind`: equivalent for all kinds. cli requires an owned cli agent,
  subagent requires an owned subagent, background requires an owned subagent or an owned background entry, all
  else falls to orchestrator. Both use `ownedBySession`. Background lanes with a record-less (D13) agent still
  resolve to `background` and render the strip. No behaviour lost.
- Main's `agentNode`, tree-builder, transcript fallback, `messages/loading/error` signals and the
  `ptah-subagent-usage-summary` wrapper line were dropped; usage summary is rendered inside
  `subagent-lane.component.ts` (imports `SubagentUsageSummaryComponent`), so no visible loss.
- Spec: main's layout test ("bounds only the orchestrator host...") is retained; main's execution-node/fallback
  tests (fill, saved-transcript Refresh, real node Stop, nested Copy) were dropped with the code they covered;
  branch's store-backed tests remain.

## Findings

### Minor 1 — stale doc comment

`libs/frontend/chat-ui/src/lib/molecules/background-agent-strip.component.ts:139` still says the actions menu
holds "view transcript / steer / send to background / stop". Misleads maintainers about a removed action.
Fix: drop "view transcript /".

### Minor 2 — dead field `TrayAgentContext.agentId`

`libs/frontend/chat/src/lib/services/session-agents/session-agent-tray.ts:28` (set at :179 and :235). Its only
consumer was `viewTranscript`. Nothing reads it now (spec only sets it, `session-agent-tray.service.spec.ts:35`).
Not a bug; remove in a follow-up or keep deliberately and note it.

### Minor 3 — negative assertion on a deleted test id

`libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.spec.ts:180` asserts
`subagent-transcript-button` is null. Matches plan row ("bubble spec: no subagent-transcript-button"), harmless;
it will pass forever, so it only guards against reintroduction.

## Five logic questions (short)

1. Silent failure: none found. Removed paths had no remaining caller, so no success-looking dead call remains.
2. User action: menu/strip no longer offer View transcript; background/subagent lane Escape and back still work.
3. Wrong data: lane kind resolution is unchanged in effect; ownership filter still applied for all kinds.
4. Dependency failure: the lane now degrades via the store's history load/error states (outside this review).
5. Missing: P4 baseline entry stays deliberately; confirm the baseline contract treats it as allowed (orchestrator
   reports the host-source contract spec passes).

## Verdict

APPROVE. Remaining risk: low; the three items above are cosmetic.
