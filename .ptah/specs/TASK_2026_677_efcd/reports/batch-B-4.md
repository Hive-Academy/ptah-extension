# Batch B-4 report: inspector component tree + task reader (chat)

Status: IMPLEMENTED, awaiting team-leader MODE 2 scoped checks (test / typecheck / lint of
`@ptah-extension/chat`). Two executors: the first stopped at the context cap mid-batch; the
continuation executor reviewed its files, fixed three defects and finished the remaining items.

## Files changed

Paths relative to `libs/frontend/chat/src/lib/`.

Written by the first executor (reviewed, kept):

- CREATED `services/session-agents/session-agent-tray.ts`: pure tray mapping moved out of the tray
  component (`agentLabel`, `agentSummary`, `basename`, `tidyAgentSummary`, `backgroundStatus`,
  `fromSubagent`, `fromBackground`, `buildTrayContexts`, `agentModelsByKey`; `TrayAgentContext`,
  `AgentRowExtras`)
- CREATED `services/session-agents/session-agent-tray.service.ts`: `SessionAgentTrayService` (root):
  `contextsFor`, `extrasFor`, `focus`, `steer`, `stop`, `sendToBackground`, `viewTranscript`
- MODIFIED `components/organisms/background-agent-tray.component.ts`: delegation COMPLETE (113
  lines; entries from `buildTrayContexts`, every action through `SessionAgentTrayService`; no
  duplicated mapping). Both specs stay unchanged: they read only `entries()`, `setInput('sessionId')`,
  and provide `AgentMonitorStore`, `BackgroundAgentStore`, `TabManagerService`,
  `SubagentTranscriptViewerService`, which are exactly the service's four injections.
- CREATED `components/organisms/session-inspector/inspector-agent-actions-menu.component.ts`
- CREATED `components/organisms/session-inspector/inspector-agents-section.component.ts`
- CREATED `components/organisms/session-inspector/inspector-git-section.component.ts`
- CREATED `components/organisms/session-inspector/inspector-orchestrator-card.component.ts`
- CREATED `components/organisms/session-inspector/inspector-request-panel.component.ts`
  (`InspectorRequestPanelComponent` + `InspectorRequestLinesComponent`)
- CREATED `components/organisms/session-inspector/inspector-todos-section.component.ts`
- CREATED `components/organisms/session-inspector/session-task-reader.ts`

Fixed by the continuation executor in those files:

- `session-task-reader.ts`: TS2339 `Property 'task' does not exist on type '{}'` (line 262). The
  untyped `rpcCall(…, method: string, …)` overload is declared first and won over the typed one;
  now `rpcCall<{ task: TaskSpecDetail | null }>(…)` (same shape as shared `TasksGetResult`).
- `inspector-orchestrator-card.component.ts`: status dot had both `class` and `[class]`; the
  static classes now live inside the `dotClass` computed (one `[class]` binding).
- `inspector-agents-section.component.ts`: status word had both `class` and `[class]`; now one
  `[class]="'font-medium ' + view.statusInk"`.

Created by the continuation executor:

- CREATED `components/organisms/session-inspector/inspector-task-section.component.ts`:
  `ptah-inspector-task-section`, provides `SessionTaskReader` (component-scoped, so a closed
  inspector reads nothing). Renders nothing while the link is unknown or absent. States: skeleton
  with `aria-busy`, `Could not load task` (`role="alert"`, `Retry` with aria-label
  `Retry loading task`), `Task folder not found` (ID only, no links), ready (ID, title with full
  `title` tooltip, status label + lucide shape icon + `TASK_STATUS_INK`, derived stage when
  non-null, document list or `No documents yet`), per-document inline open error, `+N more`
  disclosure of related task IDs (`aria-expanded`, count in the accessible name). Imports tasks
  code only from `@ptah-extension/tasks-ui/presentation`.
- CREATED `components/organisms/session-inspector/session-inspector.component.ts` + `.html`:
  `ptah-session-inspector`; inputs `tabId` (required), `presentation` (`docked|sheet|embedded`),
  `hasLaneSurface`, `stats = input<SessionStatsInputs | null>(null)`; outputs `closeRequested`,
  `laneRequested`, `answerRequested`. `sheet` renders `role="dialog" aria-modal="true"`, others an
  `<aside>`, both `aria-label="This session"`. 48 px header with `<h2>This session</h2>` and the
  `Close session details` button carrying `data-inspector-close` (`INSPECTOR_CLOSE_ATTR`). D45
  order: Orchestrator, `<ng-content select="[inspectorSection]" />` (no wrapper), SESSION
  (`ptah-inspector-session-stats` when `stats`), AGENTS, PLAN LIMITS + LANES
  (`ptah-inspector-limits-lanes` when `stats?.limits`), TASK, TODOS, GIT. `limitsLinkActivated`
  -> `viewChild(InspectorLimitsLanesComponent)?.focusHeading(source)`. One polite `role="status"`
  live region fed by the sections' `announced` outputs. Model from
  `SessionInspectorStore.modelFor(tabId)`.
- MODIFIED `components/index.ts` (append-only): exports `SessionInspectorComponent` and
  `type SessionInspectorPresentation`.

Not modified: `libs/frontend/chat/src/index.ts` (see Decisions).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| `chat/src/index.ts` left unchanged | (a) add explicit exports; (b) rely on existing star chains | `src/index.ts:13` `export * from './lib/components'` already re-exports the new component; `lib/services/index.ts:116` `export * from './session-inspector'` already exports `SessionInspectorStore`, `InspectorShellController` and the types. An explicit duplicate would only shadow the star export. | yes, one line |
| Stagger indexes | per-section `--i` vs nested | Orchestrator `--i=0`, SESSION `1`; AGENTS host gets no `st-r` (its rows already carry `st-r`, `--i = staggerStart + 1 + i`; a wrapper would double the translate); `staggerStart` = 1 with SESSION else 0; PLAN LIMITS/LANES, TASK, TODOS, GIT continue at `staggerStart + 1 + rows`, `+1`, `+2`, `+3`. The CSS caps `min(var(--i), 6)` (plan-part-a2-header.md:94-95), so no cap is needed in TS. | yes |
| D-O4 turns | pass / omit | B-3 builds `OrchestratorCardModel.turns` with `countTurns(messages)` (`number \| null`, null when no user turn), so it is passed to SESSION `[turns]`; null is the component's own default (no invented value). | yes |
| Close-button focus on late mount | none / call `closeReady` | `InspectorShellController.closeReady(button)` exists for "late mount from a deferred chunk" (`inspector-shell.controller.ts:266-270`). The inspector injects the controller `{ optional: true }` (the Rail board does not provide it) and calls `closeReady` from an effect on the close-button `viewChild`. | yes |
| Task status cue | colour only / label + shape | Req 17.2 forbids colour alone: label from `TASK_STATUS_LABELS` plus a lucide shape per status (Circle, CircleDot, Eye, Ban, CircleCheck, CircleX), ink from `TASK_STATUS_INK` on the icon. | yes |
| Document rows without a host opener | hide / plain text | `FILE_LINK_OPENER` is injected `{ optional: true }` in the reader; with no opener the names render as plain text (still listed, 17.4), not as dead buttons. | yes |

## Deviations

- `chat/src/index.ts` is listed as MODIFY (append-only) in the brief but needed no change (Decisions row 1).
- Answer-miss reporting (`SessionInspectorStore.reportAnswerMiss`, plan B §5 "Answer routing") is not
  wired: B-3's store has no such method, and the 1 s card lookup is a chat-view (CV-1) concern. The
  inspector only emits `answerRequested(requestId)`.
- The `@container` CSS note in plan B §5 Quality is not applied: the sections use fixed paddings and no
  viewport queries, so there is no breakpoint to convert.

## Scoped diagnostics

`ptah_get_diagnostics` (TypeScript compiler, does NOT check Angular templates), scoped to:
`session-inspector.component.ts`, `inspector-task-section.component.ts`, `session-task-reader.ts`,
`inspector-orchestrator-card.component.ts`, `inspector-agents-section.component.ts`,
`components/index.ts`, `background-agent-tray.component.ts`, plus (first run)
`session-agent-tray.ts`, `session-agent-tray.service.ts`, `inspector-agent-actions-menu.component.ts`,
`inspector-git-section.component.ts`, `inspector-request-panel.component.ts`,
`inspector-todos-section.component.ts`.

- Requested files: 0 errors (first run had 1: `session-task-reader.ts:262` TS2339, fixed).
- Sibling files in the chat project report pre-existing spec type errors (e.g.
  `agent-card-truncation.spec.ts:137`, `compact-session-card.component.spec.ts:286`,
  `tab-bar.component.spec.ts:178`, `chat-input.component.spec.ts:981` from A2-2's file). Not B-4 files;
  reported, not fixed.
- Templates re-read by hand against class members: every signal is called, input names match the
  child contracts (`card`, `tabId`, `sessionId`, `agents`, `hasLaneSurface`, `staggerStart`, `stats`,
  `turns`, `limits`), template refs (`body`, `closeButton`, `docButton`) shadow no input, and no
  element carries both `class` and `[class]` after the two fixes above.
- No nx / jest run (decisions row 59). No `registerScope`, `any`, `@ts-ignore`, `as unknown as` or
  `[innerHTML]` in the B-4 files.

## Open items

- MODE 2 must run the three Scoped checks (test, typecheck, lint of `@ptah-extension/chat`). Watch for:
  `@nx/enforce-module-boundaries` on chat -> `@ptah-extension/tasks-ui/presentation`, and whether chat's
  Jest resolves the `/presentation` secondary path (assumption carried from B-2; no B-4 spec exercises it).
- Angular template type-check (strict templates) is only exercised by typecheck/build; the hand review
  above is the only template check done here.
- No host renders `ptah-session-inspector` yet: CV-1 mounts it in chat-view (`@defer`, `id="inspector"`
  aside per implementation-plan A2 O1, sheet keydown via `InspectorShellController.onSheetKeydown`) and
  passes `stats`. The tray component is deleted by CV-1 (R2), not here.
