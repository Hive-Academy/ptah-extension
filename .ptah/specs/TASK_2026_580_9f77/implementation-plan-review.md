# Implementation Plan Review: TASK_2026_580_9f77

VERDICT: REVISE

Reviewed against the worktree at `D:\projects\ptah-extension\.claude-worktrees\task-580`
(origin/main a90c086d7). Every plan claim I tested against code held up except the
items below. The migration analysis, the 584 coordination contract, the worktree
capture separation, the board-start flow, the Nx boundary lattice and the AC1/AC8
spec seams are all correct as written; the defects are two contract-level gaps that
should be fixed in the plan text before implementation.

## Defects

1. **Major — Lane L3 contradicts the plan's own "defaults unchanged" guarantee.**
   Plan: component 5 step 1 (plan :487-488) and lane L3 (:1247) say `archived` rows
   are excluded "unless the status filter lists it" whenever the organization map is
   present; component 5 also promises "defaults are unchanged when no new param is
   sent" (:508) and D4 promises "defaults unchanged" (:135). Both cannot hold: with
   organization available and **no** params sent, L3 as written drops every row a user
   archived, so an existing `session:list` caller — the sessions sidebar via
   `ClaudeRpcService.listSessions`
   (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:254-264`, no
   status param today) — silently loses sessions it sees today. Evidence:
   `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:353-361`
   (today's filter/slice path has no status notion). Fix: pick one semantics in the plan
   and align AC1/spec wording — either (a) archived exclusion applies only when a
   `status` filter is present (defaults truly unchanged), or (b) it always applies
   and the "defaults unchanged" claims are re-scoped to "rows with no stored
   organization row read as defaults" (L12). As written, an executor must guess.

2. **Major — Assumption A1 is contradicted by the plan's own cited evidence, and the
   remedy has no home.** A1 (:149-158) assumes a session keeps its SDK id across
   restart/resume and defers a "grep for rotation" check to the executor. But the
   plan itself cites the code that says rotation is real:
   `libs/frontend/chat-routing/src/lib/stream-router.service.ts:481` — "they go stale
   after **compaction-driven session id rotation**" — and `:263` "compaction-spanning
   conversations", implemented by `appendSession` when an event arrives with a
   session id the conversation does not contain
   (`stream-router.service.ts:336-341`, `:168-173`). On the backend, every resolved
   SDK id gets a **fresh** metadata record with no carry-over
   (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1140`,
   `createSessionIdCallback` → `metadataStore.create(realSessionId, ...)`), so if the
   id the SDK reports after compaction differs, the organization row keyed by the
   old id is orphaned and the new sidebar row silently shows defaults — AC5 fails
   silently, which is exactly the failure class this review exists for. Whether the
   metadata key actually rotates (vs. only the frontend's raw payload fields going
   stale) is not provable from the repo in this review's scope — that is the point:
   the plan labels it "not proven from source" while citing a source that asserts
   rotation. Fix: promote A1 from an assumption to a pre-A3 gate with a defined
   outcome — either (a) prove by trace that no backend path re-keys metadata to a
   new SDK id (document why the frontend's rotation never reaches
   `SessionMetadataStore`), or (b) add `rekeySession(old, new)` to component 4's
   store method list, name its call site, and give it a spec, so the executor is not
   inventing placement mid-batch. Smoke S5 alone is post-hoc and cannot repair a
   wrong key design.

3. **Minor — `SessionOrganizationRpcHandlers` must inject the service optionally,
   and the plan never says so.** `requires: []` means the handler class is
   constructed on **every** host, including VS Code
   (`libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:104-127`
   `resolveRpcHandlerPlan` pulls every enabled lib-owned entry;
   `deriveRpcSurface:58-71` shows `requires: []` is always enabled). Component 5
   (:510-526) states "new optional injections" only for `SessionRpcHandlers`; for the
   new handler it just says "Without the service: `{ok: false, ...}`". A plain
   `@inject(SESSION_ORGANIZATION_TOKENS.SERVICE)` would throw at VS Code surface
   registration. The component-9 VS Code spec would catch it, but the component
   spec should pin `{ isOptional: true }` (and the `onDidChange` subscription guarded
   on presence) so the executor does not discover it as a boot failure.

4. **Minor — PR capture can receive a tab id, violating the port contract silently.**
   Component 7 (:618-620) passes `payload.sessionId` straight to `addPrLink`, and the
   port contract says "every `sessionId` is an SDK session UUID, never a tab id"
   (:360). But `resolveHookSessionId` falls back to the closure routing id when the
   hook payload lacks `session_id`
   (`libs/backend/agent-sdk/src/lib/helpers/post-tool-use-hook-handler.ts:77-87`),
   and `sdk-agent-adapter.ts:1150-1154` confirms that fallback case is real ("a hook
   payload that genuinely lacked `session_id` and fell back to the tabId-bearing
   closure"). D3's `resolveRoot` drop handles it (no metadata under a tab id → write
   dropped and logged), so the outcome is a missed PR link, not a wrong row — but
   component 7 should state this case explicitly so the executor does not "fix" the
   drop by writing a tab-id row, and so the missed-link risk is recorded next to R5.

## Answers

**1. Migration 0050 and the twelve specs.** Correct. `0049_memory_sediment_quarantine`
is the latest entry (`libs/backend/persistence-sqlite/src/lib/migrations/index.ts:77`
import, `:364-366` registry entry), so 0050 is the right number. The twelve specs are
exactly as the plan lists: ten assert `Math.max(...versions) === 49`
(`0028…spec.ts:83`, `0030…:38`, `0038…:91`, `0039…:65`, `0040…:78`, `0041…:62`,
`0042…:70`, `0043…:54`, `0045…:33`, `0047…:34`) and two carry a version list ending
at 49 (`0044…:67-69`, `0046…:32-34`). I grepped the whole lib for other hard-coded
49s: `migration-runner.spec.ts:668,698,747` and
`sqlite-connection.service.spec.ts:47` all derive from `MIGRATIONS` dynamically and
need no change. Note 0044/0046 need the value 50 _appended to a list_, not a
`toBe` bump — the plan already says this ("two more list versions ending at 49").

**2. Coordination with 584.** No schema or ownership conflict. 584's snapshot
fields (`implementation-plan.md:324-350`: optional `sdkSessionId`/`parentSdkSessionId`,
required `workspaceRoot` = parent root, `worktreePath`, `branch`, `taskId`) map
one-to-one onto 580's nullable `parent_session_id`, `fork_of_session_id`,
`started_by` and the `recordAgentStartedSession` port
(`workspaceRoot` and `branch` required, `parentSessionId`/`taskId` optional —
matching the snapshot's optionality). 584 adds no migration and no
`SessionMetadata` field (584 D10 :155, Coordination :1152-1175); 584's Coordination
(:1169-1175) independently specifies the same single call site (spawner's
`SessionIdResolved` handler) that 580's landing-order section specifies, and the
same field mapping, so the two plans converge from both sides. Child-worktree
ownership is unambiguous: 580 records it only via `recordAgentStartedSession`;
584 fires only the shared broadcast handler. One accepted residual: if the parent's
SDK id is unresolvable at the one-shot call, `parent_session_id` stays NULL
permanently (580 marks this `[lane]`); it is bounded and documented.

**3. Worktree capture via the git namespace, not the shared handler.** The reasoning
is correct in code. `buildGitNamespace().worktreeAdd` calls `onWorktreeChanged` only
after success (`git-namespace.builder.ts:130-136`), and that handler
(`ptah-api-builder.service.ts:999-1032` `buildWorktreeChangeHandler`) is a
broadcast-only closure shared by `ptah_git_worktree_add`
(`protocol-dispatcher.ts:1298-1330` → `ptahAPI.git.worktreeAdd`) **and** 584's
`ptah_session_start` (584 plan :723-727 fires "the existing worktree change handler
(`ptah-api-builder.service.ts:999)"); 584's provisioner does not go through the git
namespace (584 :1182: it uses `resolveWorktreePath`and fires the same notification).
Recording in the shared handler would therefore attribute a child worktree to the
parent (the MCP caller of`ptah_session_start`); recording in `buildGitNamespace`via new deps cannot, and the CLI-host`worktree: false` profile
(`cli-host-profile.ts:42`) confirms the companion D8 choice to record in the SDK hook
rather than `wireWorktreeCallbacks` (`sdk-callbacks.ts:338-376` confirms the callback
has no path today). No double-record path exists.

**4. Board-start capture.** The flow is real end to end:
`TaskStartService.launchPrompt` fires `requestChatPrompt`
(`task-start.service.ts:111-124`; `ChatPromptRequest` at
`app-state.service.ts:173`), `TaskPromptBridgeService.consume` creates the tab and
holds its `tabId` (`task-prompt-bridge.service.ts:48-74`, kept alive by
`chat.store.ts:85`), and `session:id-resolved` reaches
`ChatMessageHandler.handleSessionIdResolved` with `{tabId, realSessionId}`
(`chat-message-handler.service.ts:605-614`) — the exact hook point the plan names.
The reload-loss risk is bounded, not eliminated: the pending map is webview memory
capped at 20 (L10), the loss window is only between prefill and first send, R3 names
the manual/agent fallback, and the failure table (:1015) records it. That is an
honest trade for not changing the `chat:start` contract; no defect.

**5. Session id rotation.** See Defect 2. The code the plan cites
(`stream-router.service.ts:481`) asserts rotation is real at the SDK-stream level,
and the backend mints a fresh metadata record per resolved id
(`sdk-agent-adapter.ts:1140`) with no re-key anywhere I could find; whether the
_metadata key_ rotates (vs. only stale raw payload fields) is unproven either way.
The plan needs the re-key step **decided now** (pre-placed `rekeySession` or a
documented proof it cannot happen), not left as a conditional executor discovery —
AC5's failure mode is silent.

**6. AC1 and AC8 spec coverage.** Adequate. The AC1 spec runs the real
`session:list` handler over a real store on a temp DB, fails (not skips) without a
native opener per the 0049 pattern (`0049…spec.ts:355-378` verified), and its
`total` assertion fails if production stops consulting the organization map. Every
capture path in the Data-flow table (:961-971) has a reachability spec that invokes
the production entry (hook function via `createHooks`, dispatcher case, real
PostToolUse hook after `startSessionOrganization`, real `SessionMetadataStore.delete`
for the cascade, 4 chained specs for board start). The only deferral is the 584-start
path, assigned by the landing-order contract to whichever task merges second —
documented, with the spawner spec named; acceptable.

**7. Logging and boundaries.** D15 pins `IOutputChannel` +
`PLATFORM_TOKENS.OUTPUT_CHANNEL` for new classes (token verified at
`platform-core/src/di/tokens.ts:36`; prefix precedent
`agent-sdk/src/lib/harness/harness-policy-sync.ts:44`), and modified existing classes
keep `Logger` — consistent with 584's D11. The Nx lattice holds for every planned
edge: `scope:extension` may depend on `scope:shared`+`scope:extension`
(`eslint.config.mjs:259-262`) and `type:feature` on
feature/data-access/ui/util/core (`:364-373`); the new lib
(`scope:extension,type:feature`) → persistence-sqlite (`extension,util`),
platform-core (`shared,util`), shared (`shared,util`), agent-sdk
(`extension,feature`) are all legal (tags read from each `project.json`), and
`rpc-handlers` (`extension,feature`) → the new lib is legal. The capture producers
add only the existing platform-core edge. No violation.

## Notes

- Verified correct beyond the seven checks: the `requires: []` + VS Code
  `expected-absent` reasoning (VS Code really has no SQLite — the plan's three
  citations in the user-decision section match the code); the event-driven delete
  cascade really covers the importer prune
  (`session-importer.service.ts:344` calls `metadataStore.delete`, which emits
  `'deleted'` with the workspace at `session-metadata-store.ts:976-982`); the
  `persistCliSessionReference` lineage timing is right — "Parent session not found"
  is not retried (`agent-events.ts:444-463`) so recording in the `.then` (:466-470)
  only fires when the parent is a real, persisted session; the sweep-spec merge
  points are real (`mcp-contract.sweep.spec.ts:216,1707,1731,2082`, driver failure at
  `:1213,1815`); `session:list` today is exactly as described
  (`session-rpc.handlers.ts:333-422`, `:386-387`); Electron
  `sessionMetadataEvents: false` (`rpc-host-profile.ts:75`) justifies the separate
  C.4 push.
- If both Majors are addressed with the minimal text edits suggested, I see no
  further obstacle; the plan's file:line citation accuracy was unusually high —
  every one of the ~40 claims I spot-checked resolved at the cited line.
- Suggested disposition: REVISE with a narrow edit pass (Defects 1-4 are plan-text
  changes; no component needs re-architecture).
