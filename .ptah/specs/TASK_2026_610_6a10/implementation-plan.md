# Implementation Plan - TASK_2026_610_6a10

Revision 3 (2026-10-04). Revision 2 applied the user scope change "Electron only" [user] (`context.md`, "User scope
change 2026-10-04"). Revision 3 fixes the 8 defects in `implementation-plan-review.md` and applies the Gate 2 user
decisions [user]:

- The static text kind and the note kind go into TASK_2026_594's `dashboard-catalog/3`, so there is one catalog bump.
- PR E is removed from this approval.

Contract: `task-description.md` rev 3 (Gate 1), as narrowed by those decisions. Paths are relative to the worktree
root `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\` unless absolute.

## Inputs and constraints

- Requirements used: `task-description.md` (rev 3), `context.md` (including the scope change),
  `research-report.md`, `task-description-review.md`, `architecture-evidence.md` (four relayed evidence reports,
  A-D). Lines the architect re-read are marked "spot-checked".
- Corrections applied:
  - The scope change [user]: Electron only; no TUI work; no VS Code-specific work.
  - Assistant text does **not** go through `ptah-markdown-block`. It goes through a raw `<markdown>` in
    `ExecutionNodeComponent` (`execution-node.component.ts:136-138`, spot-checked).
  - `chat-ui` is `type:feature`.
  - No `SurfaceUpdateInbox` class exists (evidence C4).
- Design handoff used: none (no `design-spec.md`/`design-handoff.md`). Decision affected: visual details of the
  tests row, the reason line, and the pending/unavailable/snapshot states. This plan fixes structure, text and a11y
  semantics. It reuses existing atoms and the `text-base-content-muted` token; a designer may restyle without
  changing contracts.
- Missing decision-critical input:
  - Req 4.1 A2UI raw-schema addendum. PR E is deferred out of this approval [user].
  - TASK_2026_594 `dashboard-catalog/3` is not in code yet (A8). The D1 file list is exact but marked "confirm after
    594 lands".

## Deferred by user scope change [user]

These items are not planned. They return in a follow-up task.

| Item | Requirement | What is deferred |
| --- | --- | --- |
| TUI turn summary | Req 1.9 (all rules), 1.2 "shared matcher … identical outcomes in both" for the TUI side | TUI summary lines, the TUI Bash-command retention in `use-chat.ts`, the shared-fixture parity spec |
| TUI change-set subscription | Req 1.9 "Missing change sets", Risk "The TUI does not receive change sets" | Subscribing the TUI to `git:turnChangeSet` |
| TUI plain-text blocks | Req 2.16 (Gate 1 D4) | `ptah-ui` → `renderSurfaceText` in the TUI; TUI source resolution |
| TUI hint | Req 2.14 "the TUI" | The hint is not sent in TUI sessions |
| VS Code webview rendering | Req 1.11 (VS Code half), Req 2.1 / 2.14 / 3.x for the VS Code webview, NFR "Compatibility: VS Code … webviews" | No fence rendering, host sources, tests row or hint in VS Code. The fence stays an ordinary code block there, and a regression spec pins it. |
| VS Code-like measurements | Req 4.12 and 5.10 "VS Code-like host" | Tokens and `tools/list` are measured on the Electron-like host only |

## Deferred to a separate Gate 2 amendment (after the Req 4.1 raw-schema check) [user]

| Item | Requirement | Condition to return |
| --- | --- | --- |
| A2UI v0.9 adapter on `ptah_surface_update` (former PR E, former component 15, former decision 13, former L-15) | Req 4.1-4.12 | The Req 4.1 addendum is recorded in `research-report.md` with a pinned a2ui-project commit. A Gate 2 amendment to this plan then maps every Req 4 criterion to a batch and a test derived from that addendum's envelope. |

The PR D catalog work (`text-block` under `dashboard-catalog/3`) stays in this approval. It is the prerequisite the
amendment will rely on for A2UI `Text`.

The shared webview code still compiles and runs in VS Code. The only VS Code obligation is "nothing changes there",
which the regression spec in component 11 proves.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| Assistant text renders through a raw `<markdown [data]="renderedContent() \| surfaceMarkdown: surfaceActive()">` in the `text` case | `execution-node.component.ts:115-141` (spot-checked) | Mount point is this branch, in `chat`. The markdown lib is untouched. |
| `message` case forwards children (`:249-262`). `agent` children use `bubbleChildTemplate` (`:218-247`). `sendMessage` nests agent nodes (`:176`). | same (spot-checked) | An input forwarded only from the `message` case reaches top-level assistant text, never subagent text (Req 2.10). |
| `ExecutionNodeComponent` inputs are `node`, `isStreaming`, `isFinalizing`, `getPermissionForTool` | `:313-337` (spot-checked) | Block identity needs the message id passed in. The node id is `node().id`. |
| The bubble mounts the root `ptah-execution-node` at `message-bubble.component.html:102-110`, falling back to `<markdown>` on `rawContent` (`:111-118`) | spot-checked | The turn context enters the tree here. |
| `electronOnlySurface: CanMatchFn = () => inject(VSCodeService).isElectron` | `apps/ptah-extension-webview/src/app/electron-only-surface.guard.ts:19-20` (spot-checked); used on route `apps` (`app.routes.ts:160-168`) | The Electron gate in this repo is `VSCodeService.isElectron`. Components reuse the same source of truth (`vscode.service.ts:171`, `get isElectron()`). |
| `VSCodeService.isElectron` read as a snapshot in services | `boot-status.service.ts:135-139`, `electron-layout.service.ts:112` (grep) | Precedent for gating non-route UI on the host. |
| `'full'` preset: private DOMPurify, class allowlist, `FORBID_TAGS`/`FORBID_ATTR`, containment root | `libs/frontend/markdown/src/lib/provide-markdown-rendering.ts:42-283, 475-498` (read) | No mount marker in HTML, so Req 2.9 holds by construction. |
| Code fences render as escaped `<pre><code class="language-…">` | `marked-extensions.ts:180-214` (read) | A fallback fence through its own `<markdown>` is byte-identical to any other fence (Req 2.3). |
| `markdown` is `scope:shared,type:ui` and cannot import `declarative-dashboard`. `chat`/`chat-ui` (`scope:webview,type:feature`) may. | `markdown/project.json` (read); evidence B6 | The renderer is consumed from `chat-ui`. The lattice is unchanged. |
| Lazy secondary-entry precedent `@ptah-extension/chat-ui/change-set-card`, used only inside `@defer` | `chat-ui/src/change-set-card.ts:1-17`, `tsconfig.base.json:49-51` (read) | New entries `@ptah-extension/chat-ui/ptah-ui` and `/turn-recap` |
| `SurfaceRendererComponent` signal inputs `renderable`, `viewState`, `interaction`. It injects only `SURFACE_VIEW_MODEL_BUILDER`. Submit and selection fire only for `surface.submit`/`dashboard.select`. Local sort/filter/page/expand state is kept in a `linkedSignal`. | evidence A1; selector and title spot-checked `:182-199, :224` | Fence envelopes carry no actions or inputs, so only local view actions exist (Req 2.17). A new `renderable` updates in place (Req 3.2). |
| The renderer always renders `<h2>{{ title() }}</h2>`, and `RichText.text` has no minimum length | `surface-renderer.component.ts:190-192` (spot-checked); `dashboard-spec.schemas.ts:79, 97-102` (spot-checked) | The renderer must omit an empty heading (component 9). |
| Display kinds take literal props only | evidence A4; table schema `surface.schemas.ts:358-385` (spot-checked) | Host sources are applied by literal substitution before validation. |
| `requireOneDataSource` is presence-based | `dashboard-spec.schemas.ts:239-251` (spot-checked) | `rows: []` is valid, so empty sources render an empty table plus a description. |
| `validateSurfaceDocument(doc: unknown, countBytes: DashboardJsonByteCounter): SurfaceDocumentValidation` | `surface.validator.ts:617-630` (spot-checked); `DashboardJsonByteCounter` at `dashboard-spec.validator.ts:42` | The only trust boundary. The webview supplies a `TextEncoder` counter (`jsonUtf8Bytes` is backend-only, `platform-core/src/utils/json-budget.ts:44`). |
| `SurfaceContent = {contract:'dashboard-spec/2'; surface; dataModel}`; `SurfaceIdSchema` `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`, 1..128 | evidence A2, A3 | Pipeline output type; surface id derivation |
| `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId = 8` | evidence A3 (`surface-catalog.ts:145-155`) | Live cap = 8 per tab (Req 5.4) |
| `renderSurfaceText(view)` | evidence A5 | The snapshot text alternative |
| `surface.index.ts` is 118 lines | `wc -l` (run) | The fence pipeline is exported there (≤150-line barrel, `CONVENTIONS.md` §3) |
| `ExecutionChatMessage.tokens/cost/duration`; `ExecutionNode.status/toolName/toolInput/children` | evidence B2 (`agent.ts:143-150`, `node.ts:35-41,138-222`) | `$usage` and `$tests` are derivable in the webview. No new RPC (Req 1.13). |
| No per-message context snapshot survives reload | evidence B2 | **`$context` is dropped** (Req 3.10) |
| `anchorChangeSets` and `anchorInTurnWindow` join change sets to messages by time window; there is no turn id | evidence B3 (`transcript-change-set-anchors.ts:47-135`) | The per-message `$diff` join generalises that rule |
| `ChangeSetStore.changeSetsFor(sessionId)`, `ensureLoaded`, push handling | evidence B4 (`change-set.store.ts:299-394`) | `$diff` source |
| `TranscriptRenderWindow` destroys and recreates bubbles; the last 6 are always mounted | evidence B3 | Permitted remounts (Req 2.7) |
| `CostBadgeComponent` null → unavailable (`cost-badge.component.ts:37-45, 64-69`); `DurationBadgeComponent.formatDuration()` (`duration-badge.component.ts:27`) | evidence B5; duration spot-checked | Formatters move to shared so the badges and the resolver agree (Req 3.1) |
| `assembleSystemPrompt` pushes identity, then `PTAH_CORE_SYSTEM_PROMPT`, then user prompt, output style, enhanced prompts | `sdk-query-options-builder.ts:295-330` (spot-checked) | The hint is pushed after the core prompt, gated by a new input field |
| Ptah CLI lanes call `assembleSystemPrompt` directly | evidence C2 (`ptah-cli-spawn-options.service.ts:185`) | They never set the field, so they get no hint |
| `mcpToolProfile` precedent for a session-shaping client field: `ChatStartParams.mcpToolProfile` (`rpc-chat.types.ts:66`); zod `chat-rpc.schema.ts:61, 75`; `AISessionConfig.mcpToolProfile` (`ai-provider.types.ts:161`); propagated in `chat-session.service.ts:122, 157, 567, 745, 1429` and `chat-slash-command-router.service.ts:127-128` | grep (run) | The hint flag follows exactly this path (decision 8) |
| `HostProfile.host: 'vscode' \| 'electron' \| 'cli' \| 'tui'`; Electron's profile sets `host: 'electron'` | `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts:46` (spot-checked); `apps/ptah-electron/src/rpc-host-profile.ts:25` (grep) | The backend knows its host, but only at RPC-surface registration. No service reads `profile.host` today (grep), so the host has to be threaded to the builder (decision 8). |
| `assembleSystemPrompt({...})` is constructed inside `buildSystemPrompt` | `sdk-query-options-builder.ts:1693-1700` (spot-checked) | The exact place where the hint boolean is computed |
| `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId: 8` | `libs/shared/src/mcp-apps-contracts/surface-catalog.ts:147` (spot-checked) | The live cap value (decision 10) |
| `assertEagerClosureKept(stats, electronOnly)` walks `main.js` `import-statement` imports in `stats.outputs`; exported with `generate`, `classify`, `isElectronOnlyInput`, `assertStatsMatchBuild` | `scripts/electron-only-chunks.js:150-173, 195-201` (spot-checked) | The eager-closure walk the new bundle gate reuses (component 17) |
| `RPC_METHOD_NAMES` (`libs/shared/src/lib/types/rpc.types.ts:4122`), `MESSAGE_TYPES` (`libs/shared/src/lib/types/messages/message-constants.ts:18`) | grep (run) | The method and push registries the Req 1.13 contract test snapshots (component 16) |
| No host identity in session config; `PlatformType` has no TUI; VS Code, Electron, TUI and `ptah-cli` all reach `SdkQueryOptionsBuilder.build` through `chat:start/continue` | evidence C2; `platform-core/src/types/platform.types.ts:140-145` (spot-checked) | The host must be threaded as a trusted DI value (`TOKENS.HOST_KIND`). A client flag narrows to webview sessions within Electron (decision 8). |
| `MessageSenderService` issues `chat:start` (`:440`) and `chat:continue` (`:689`) | grep (run) | One frontend site sets the flag |
| Skills ship as `apps/ptah-extension-vscode/assets/plugins/<plugin>/skills/<name>/SKILL.md` and are distributed via `content-manifest.json` (`manifest:generate` / CI `manifest:check`) | evidence C5; `ls` (run) | `ptah-surface-authoring` does not exist yet |
| Initial-chunk method: `nx build ptah-extension-webview --configuration=production --skip-nx-cache --stats-json`, attributed via `stats.json` | evidence D5 | Req 5.1/5.2 method. The webview build is shared, so one measurement covers Electron. The current initial is ~3.40 MB. |
| Coding `tools/list` = `JSON.stringify(result.tools).length` from a real `handleMCPRequest` | evidence C6 | Req 5.10/4.12, Electron-like host only [user] |
| `libs/shared/src/lib/utils/` is the framework-free shared place (`pickPrimaryModel`) | evidence D4 | The matcher, tests detection, snapshot and formatters live there |
| `gpt-tokenizer` 4.0.0 resolved | `node -e` (run) | Token budgets |

## Architecture decision

### Decisions

1. **Fence mount (Req 2.1, 2.9, 2.10): split raw text before markdown, in `chat`.**
   - The `text` branch of `ExecutionNodeComponent` keeps today's `<markdown>` unless both of these hold:
     - it received a non-null `ptahUi` context, which is only on Electron (decision 2);
     - the text has a line that is exactly ```` ```ptah-ui ````.
   - When both hold, it `@defer`s to `PtahUiMessageTextComponent` (entry `@ptah-extension/chat-ui/ptah-ui`).
   - That component segments the raw text:
     - markdown segments render through `<markdown>`, the same element and pipe as today;
     - closed fences render `PtahUiBlockComponent`.
   - No marker enters HTML. Mounting is decided from raw text by Angular control flow (Req 2.9).
   - Rejected: a marked-extension placeholder. It is forgeable (TASK_2026_532 defects 1-6), `markdown` cannot import
     the renderer, and it loosens the sanitiser.
2. **Electron gate [user + lane-proposed mechanism].**
   - `MessageBubbleComponent` builds the `ptahUi` context only when `inject(VSCodeService).isElectron` is true. This
     is the same source of truth as `electronOnlySurface` (`electron-only-surface.guard.ts:19-20`). The transcript
     computes source snapshots and the tests row only on Electron.
   - In VS Code the context is `null`, so the execution node never evaluates the fence line or loads the chunk. The
     fence stays an ordinary code block with no reason line.
   - A route guard cannot be used, because chat is the default route on both hosts.
3. **Lazy loading (Req 5.1, 5.2, 5.9).** The only eager additions are four small, zod-free pieces:
   - the line check in `chat`;
   - the context type (type-only);
   - `PtahUiLiveWindow`;
   - PR A's shared turn utils.

   The parser, converter, resolver, zod, the validator, `declarative-dashboard` and the chart code are reached only
   via `@defer (on immediate)`. `@placeholder` and `@error` render today's `<markdown>`.
4. **Fence pipeline location: shared, framework-free.**
   - `libs/shared/src/mcp-apps-contracts/ptah-ui-*.ts`, exported from `surface.index.ts`.
   - **Only the Electron webview uses it now** [user scope]. It stays in shared because it is pure, zod-bound through
     the validator, and the natural home for the deferred TUI (Req 2.16) and the A2UI adapter's sibling code.
   - Moving it later would churn the corpus specs.
5. **Host sources are literal substitution.**
   - The converter emits a canonical `PtahUiConversion = { envelope, bindings }`. Bound cells keep `"$src.field"` and
     bound tables have `rows: []`; this is the Req 5.13 unresolved JSON.
   - The resolver substitutes values from a `TurnSourceSnapshot`, or `pending`/`unavailable` text.
   - The pipeline then validates.
   - Rejected: binding paths in display kinds. That is a contract and catalog change colliding with 594.
6. **`$context` does not ship** (Req 3.10). No per-turn value survives reload (B2). It is an unknown name and is absent
   from the hint, the skill and the table.
7. **Hint location (Req 2.14, 5.11).**
   - The constant `PTAH_UI_FENCE_HINT` lives in `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts`.
   - `assembleSystemPrompt` pushes it after `PTAH_CORE_SYSTEM_PROMPT` (`:310`) iff `AssembleSystemPromptInput.ptahUiHint === true`.
8. **Hint audience: backend host gate AND coding profile AND client flag [lane-proposed].**
   - **Trusted host fact:**
     - New token `TOKENS.HOST_KIND = Symbol.for('HostKind')` in `libs/backend/vscode-core/src/di/tokens.ts`, typed
       `'vscode' | 'electron' | 'cli' | 'tui'` (mirrors `HostProfile.host`, `host-profile.ts:46`).
     - **Only the Electron app registers it**, `{ useValue: 'electron' }`, in
       `apps/ptah-electron/src/di/phase-1-infra.ts`. That is before `phase-2-libraries.ts` registers `agent-sdk`
       (A-10).
     - Every other host leaves it unregistered, which means "not Electron". No VS Code, TUI or CLI change is needed.
   - **Builder:**
     - `SdkQueryOptionsBuilder` injects it as the last optional constructor parameter, with
       `@inject(TOKENS.HOST_KIND, { isOptional: true }) private readonly hostKind?: HostKind` (same pattern as
       `:944-951`).
     - `agent-sdk` (L3) → `vscode-core` (L1) is an allowed direction. The builder already imports `TOKENS` from
       `@ptah-extension/vscode-core` (`:17`).
   - **Client flag:**
     - `ChatStartParams`/`ChatContinueParams` gain `ptahUiFence?: boolean`, zod `z.boolean().optional()` beside
       `mcpToolProfile` (`chat-rpc.schema.ts:61, 75`).
     - It is carried into `AISessionConfig.ptahUiFence` at every `mcpToolProfile` propagation site
       (`chat-session.service.ts:122, 157, 567, 745, 1429`; `chat-slash-command-router.service.ts:127-128`).
     - The Electron `MessageSenderService` sets it to `true`.
     - It is kept because Electron also hosts sessions whose transcript is not this webview: messaging gateway,
       harness and one-shot sessions. Those never send it.
   - **Exact expression.** It is computed in `buildSystemPrompt`, as a new property in the `assembleSystemPrompt({...})`
     object literal at `sdk-query-options-builder.ts:1693`:

     ```ts
     ptahUiHint:
       this.hostKind === 'electron' &&
       (sessionConfig?.mcpToolProfile ?? 'coding') === 'coding' &&
       sessionConfig?.ptahUiFence === true,
     ```

     `?? 'coding'` encodes the documented default "Absent means `coding`" (`rpc-chat.types.ts`, `ChatStartParams.mcpToolProfile`).
   - **`assembleSystemPrompt`:** pushes `PTAH_UI_FENCE_HINT` iff `input.ptahUiHint === true`. Every other caller
     (Ptah CLI lanes, `ptah-cli-spawn-options.service.ts:185`) omits the field and gets no hint.
   - **Result:** the hint is sent only to Electron-hosted, coding-profile, Electron-webview chat sessions.
     - A spoofed `ptahUiFence: true` from VS Code, the TUI, `ptah-cli` or a proxy gets no hint, because `hostKind` is
       not `'electron'` there.
     - On Electron, an Apps session gets no hint (profile), and non-webview sessions get none (no flag).
   - **Why:** the host fact is established by the process that boots, not by the caller. The client flag only narrows
     within Electron. One registration site keeps VS Code and the TUI untouched.
   - Rejected: the client flag alone. It is caller-controlled (review defect 2).
   - Rejected: reading `HostProfile` in `rpc-handlers` and passing a trusted bit down. `HostProfile` is used only at
     `registerRpcSurface` (`register-rpc-surface.ts:133`), which runs after services are wired. Threading it would
     also touch all four hosts.
   - Draft final text (PR D), 69 `gpt-tokenizer` 4.0.0 tokens (counted):
     `Visual blocks: you may add a ```ptah-ui fenced block to a reply. Elements: title, stats, table, list, chart line|bar, note. Host data by name, never typed: $diff, $tests, $usage. Invalid blocks show as code. Grammar and examples: skill ptah-surface-authoring.`
   - PR B omits the "Host data…" sentence and `note`. PR C adds the sources and PR D adds `note`. Each is re-measured.
9. **On-demand skill.**
   - `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/ptah-surface-authoring/SKILL.md`, with the
     `ptah-ui` reference in `references/ptah-ui.md`.
   - PR B creates the skill if 594 has not; otherwise it adds the reference and one pointer.
   - The manifest is regenerated. The skill is a shared asset, not VS Code-specific work.
10. **Live cap (Req 5.4).**
    - `PTAH_UI_LIVE_CAP = 8` = `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId`, whose value is `8`
      (`surface-catalog.ts:147`).
    - Justification: a routing id is one chat context on the Apps page, and the host already accepts up to 8 live
      `SurfaceRendererComponent` instances in it. A coding-chat tab is the same unit (one session's transcript). A cap
      of 8 therefore never exceeds a per-context renderer load the product already ships. A smaller cap would snapshot
      blocks the user is likely still reading. A larger one would exceed the accepted budget.
    - **Invariant** (asserted by the instrumented test in component 9):
      - (1) At any time, per tab: live blocks ≤ 8.
      - (2) A snapshot block reads no source signal (its `renderable` is frozen; no `snapshot`-input-driven
        recomputation).
      - (3) A snapshot block's `ChangeDetectorRef` is detached.
      - (4) A snapshot block has no enabled or focusable control (`inert` ancestor).
      - (5) Remounting a snapshot block outside the newest 8 keeps it a snapshot.
    - A tab-scoped `PtahUiLiveWindow` keeps identity keys in order. Live = among the newest 8.
    - A snapshot works like this:
      - it freezes its `renderable`, so no source reads happen;
      - it wraps the renderer in an `inert` element and detaches change detection;
      - it renders a visually hidden `renderSurfaceText` alternative outside the inert element (NFR a11y).
11. **Identity and streaming (Req 2.6, 2.7).**
    - Re-segment on each `renderedContent()` (one string per frame). Track keys are `md:<n>` and `ui:<ordinal>`.
    - An open fence stays in the trailing markdown segment.
    - A closed fence is instantiated once.
    - Identity = `(messageId, node().id, ordinal)`.
12. **Turn grouping.**
    - A turn runs from one user message to the next. The turn-ending message is the last assistant message of a
      finalized turn (`index < streamingBoundary`, B8).
    - `$diff` = the change set whose `(turnStartedAt, turnEndedAt]` window contains the block message's
      `transcriptOrderKey`.
    - `$tests` and the tests row cover every assistant tree in the turn.
    - `$usage` = the block's own message.
13. **Catalog [user, Gate 2].**
    - `text-block` (static text) is added at `dashboard-catalog/3`, the same version TASK_2026_594 introduces. The
      fence `note` maps to 594's `alert` kind. There is one catalog bump in total.
    - D1 must not change `SURFACE_CATALOG_VERSION`. It depends on 594 having set it to `'dashboard-catalog/3'`.
    - If 594's owner folds `text-block` into 594's own PR, D1 reduces to verifying it with the D1 specs.

### Rejected alternatives

| Alternative | Why it loses |
| --- | --- |
| Marked-extension mount | Forgeable; `markdown` cannot import the renderer; loosens the sanitiser |
| A `ptah_render` tool | Superseded by the fence decision (Req 5.10) |
| Bindings in display kinds | Contract and catalog churn colliding with 594 |
| `$context` from live stats | Forbidden by Req 3.10 |
| Shadow DOM or iframe | No agent HTML exists. The validated declarative renderer is the sandbox (TASK_2026_490 Rev 4 C). |
| Client flag alone as the hint gate | Caller-controlled, so it is not a trust boundary (review defect 2; decision 8) |
| Host DI value alone as the hint gate | Over-includes non-webview Electron sessions (gateway, harness); the client flag narrows within Electron |

### Assumptions (each with its resolving check)

- **A-1.** After reload, stored Bash `ExecutionNode`s keep `toolInput.command` and a terminal `status`. Check: a
  `session-loader` fixture. If they do not, Req 1.8 applies and no tests row renders.
- **A-2.** The Bash tool's `toolName` is `'Bash'`, and `run_in_background` is in `toolInput`. Check: an existing
  execution-tree spec fixture.
- **A-3.** An aborted turn shows on the root message node (`interrupted`/`error`) or through
  `TabState.lastTerminalReason`. Check: `message-finalization.service.ts:153-171` and the tab-manager abort path.
  "Incomplete" = root `interrupted|error`, or a non-terminal test node after finalization.
- **A-4.** Assistant messages with `streamingState === null` are legacy only. Check: the finalization and loader
  paths. If they are live, blocks there stay code blocks (safe), recorded as a gap.
- **A-5.** Message copy and history copy read node or raw text, not the DOM. Check: `copy-button.component.ts` call
  sites. The reason line carries `data-ptah-ui-reason` and sits outside every `<markdown>`.
- **A-6.** `ChangeSetStore` holds a turn's change set once the tab leaves streaming and `session:turnEnded` is handled.
  Check: the store spec. Until then `$diff` is `pending`. After that, no covering change set means `unavailable`. A
  late push updates in place.
- **A-7.** `chat-session.service.ts` propagates every `ChatStartParams`/`ChatContinueParams` field it maps at the five
  cited sites. No other start/continue entry, such as a slash command or resume, builds `AISessionConfig` without
  them. Check: grep `mcpToolProfile` callers again in batch B7a. Every site that forwards `mcpToolProfile` must
  forward `ptahUiFence`.
- **A-8.** 594's `alert` exposes tones that can carry `info|ok|warn|error`. Check after 594 merges; map
  `ok → success` if needed.
- **A-9.** Resolved: `surface-renderer.component.spec.ts`, `sdk-query-options-builder.spec.ts`,
  `chat-rpc.schema.spec.ts`, `message-sender.service.spec.ts` and `chat-continue-slash-before-resume.spec.ts` exist
  (`ls`, run).
- **A-10.** `phase-1-infra.ts` runs before any resolution of `SdkQueryOptionsBuilder`, so the optional injection sees
  `'electron'`. Check: the order in `apps/ptah-electron/src/di/container.ts`, and the B8c container spec resolving the
  builder and asserting `hostKind === 'electron'`. If the order differs, register in `phase-0-platform.ts`.
- **A-11.** 594 merges with `SURFACE_CATALOG_VERSION = 'dashboard-catalog/3'` and an `alert` kind. Check: 594's merged
  diff before D1 starts. The D1 file list is "confirm after 594 lands".

### Effect on existing code

- **Replaced:** the badge-local cost and duration formatting, now in shared formatters. The `text` branch of
  `ExecutionNodeComponent` gains a guarded alternative.
- **Left alone:**
  - the markdown lib and all presets;
  - the change-set card;
  - footer badge output;
  - the native `operation` input of `ptah_surface_update`;
  - the coding tool list;
  - `dashboard-spec/1` and `/2` on the Apps page;
  - every VS Code-visible behaviour;
  - `apps/ptah-tui`.

## Component specifications

PR tags **[A]**…**[D]** follow `task-description.md` "Delivery order and PR split". PR E is deferred [user].

### 1. Test-command matcher and turn tests detection [A]

- Purpose: Req 1.2 classification and per-turn test-run collection.
- Responsibilities:
  - `classifyTestCommand(command: string): boolean`: quote-aware segmentation and R1-R6 exactly as normative.
  - `collectTurnTests(roots: readonly ExecutionNode[], opts: { finalized: boolean }): TurnTestRun[]` with
    `TurnTestRun = { command: string; outcome: 'passed'|'failed'|'unknown' }`.
    - Depth-first in execution order, including agent subtrees.
    - Node filter: `type === 'tool' && toolName === 'Bash'` (A-2). `toolInput.run_in_background === true` → `unknown`.
    - Each node is listed once. The outcome comes from the node status table.
  - `summarizeTurnTests(runs): { total; passed; failed; unknown }`.
- Verified contracts: `ExecutionNode` (evidence B2).
- Dependencies: shared types only (zod-free main barrel).
- Integration points: comp. 4 (transcript), comp. 8 (resolver). The TUI consumer is deferred.
- Failure behaviour: pure. Malformed input is treated as no match.
- Quality: a hand-written tokenizer with no backtracking regex.
- Verification seam: every positive and negative fixture in the Req 1.2 example table, plus the status table. The
  fixture module is kept separate so the deferred TUI can reuse it.
- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\shared\src\lib\utils\test-command-matcher.ts` (+ `.spec.ts`)
  - CREATE `...\libs\shared\src\lib\utils\test-command.fixtures.ts`
  - CREATE `...\libs\shared\src\lib\utils\turn-tests.utils.ts` (+ `.spec.ts`)
  - MODIFY `...\libs\shared\src\lib\utils\index.ts`

### 2. Turn source snapshot and usage formatters [A]

- Purpose: the Req 1.13 host-source read layer, plus a single set of cost and duration formatters.
- Responsibilities:
  - `TurnSourceSnapshot`, readonly:
    - `{ state: 'pending'|'terminal'; incomplete: boolean;`
    - `diff: {kind:'available'; changeSet: TurnChangeSet} | {kind:'unavailable'} | {kind:'pending'};`
    - `tests: {kind:'available'; runs: TurnTestRun[]} | {kind:'unavailable'} | {kind:'pending'};`
    - `usage: {kind:'available'; input; output; cost: number|null; durationMs} | {kind:'unavailable'} | {kind:'pending'} }`
  - `buildTurnSourceSnapshot({ turnMessages, blockMessage, changeSet: TurnChangeSet | null | 'pending', finalized }): TurnSourceSnapshot`
  - `formatUsdCost(cost: number | null | undefined): string | null` uses the `cost-badge` rule (`:64-69`).
    `formatDurationMs(ms: number): string` matches `DurationBadgeComponent.formatDuration` (`:27`).
- Verified contracts: `TurnChangeSet` (`rpc-change-set.types.ts:47-70`), message stats (`agent.ts:143-150`).
- Dependencies: comp. 1.
- Integration points: comps. 3, 4, 8.
- Failure behaviour: pure. Missing tokens or duration → `unavailable`, never 0.
- Verification seam: unit specs. The existing `cost-badge`/`duration-badge` specs pass unchanged (Req 1.3).
- Files:
  - CREATE `...\libs\shared\src\lib\utils\turn-sources.utils.ts` (+ `.spec.ts`)
  - CREATE `...\libs\shared\src\lib\utils\usage-format.utils.ts` (+ `.spec.ts`)
  - MODIFY `...\libs\shared\src\lib\utils\index.ts`
  - MODIFY `...\libs\frontend\chat-ui\src\lib\atoms\cost-badge.component.ts`
  - MODIFY `...\libs\frontend\chat-ui\src\lib\atoms\duration-badge.component.ts`

### 3. Tests row component [A]

- Purpose: the tests-run section next to the existing change-set card (Req 1.2, 1.4, 1.6, 1.7, and 1.11 Electron).
- Responsibilities:
  - `TurnTestsRowComponent` (`ptah-turn-tests-row`, standalone, OnPush), with inputs `runs` and `incomplete`.
  - It renders a "Tests" heading, "(incomplete)", and one row each: outcome word (text, not colour alone) + command.
  - It renders nothing for an empty list, and no file or stats content (Req 1.12).
- Verified contracts: the lazy-entry precedent (`change-set-card.ts`).
- Integration points: transcript `@defer` via the new entry `@ptah-extension/chat-ui/turn-recap`.
- Failure behaviour: presentational.
- Quality: axe zero serious or critical in both themes.
- Verification seam: a component spec with axe.
- Files:
  - CREATE `...\libs\frontend\chat-ui\src\lib\molecules\turn-recap\turn-tests-row.component.ts` (+ `.spec.ts`)
  - CREATE `...\libs\frontend\chat-ui\src\turn-recap.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\tsconfig.base.json`

### 4. Transcript turn grouping, tests-row mount [A]; per-message `ptahUi` inputs [B/C]

- Purpose: turn groups, the per-message `$diff` join, and the Electron-only tests row and source snapshots.
- Responsibilities:
  - **PR A:**
    - Pure `transcript-turns.ts`:
      - `groupTurns(messages): TranscriptTurn[]`, where `TranscriptTurn = { endMessageId; messageIds; finalized; incomplete }`;
      - `changeSetForMessage(message, changeSets)`, the `anchorInTurnWindow` rule (`transcript-change-set-anchors.ts:47-60`)
        generalised to any message.
    - Transcript computed `turnTestsAnchors` for finalized turns, **only when `isElectron`**.
    - The slot after the bubble (`chat-transcript.component.html:69-103`) gets a second
      `@defer (when runs.length > 0)` rendering `ptah-turn-tests-row`. The change-set block is unchanged.
  - **PR B:** provide `PtahUiLiveWindow` beside `TranscriptRenderWindow` (`:153`), and pass `[ptahUiOrderKey]` to the
    bubble.
  - **PR C:** a computed `ptahUiSnapshots: ReadonlyMap<messageId, TurnSourceSnapshot>` (Electron only) from
    `changeSetStore.changeSetsFor(sessionId)`, the turns and `streamingBoundary`. It is passed as
    `[ptahUiSnapshot]`.
- Verified contracts: `changeSetAnchors` (`:476-485`), `streamingBoundary` (`:455-457`), render-window gating
  (`.html:46-60`), `changeSetsFor` (`change-set.store.ts:299`). All from evidence B3/B4.
- Failure behaviour: no matching window → `$diff` unavailable. Grouping skips unknown roles.
- Quality: O(messages) on the existing frozen-while-hidden `vm`. Nothing is computed on VS Code.
- Verification seam:
  - `transcript-turns.spec.ts`.
  - `chat-transcript.change-set.spec.ts`:
    - the card still mounts after the turn-ending message (Req 1.1);
    - no row or card for a no-op turn (1.4);
    - one per-turn file listing (1.12);
    - the reloaded tests row (1.8);
    - **VS Code (`isElectron=false`): no tests row** (scope regression).
  - `chat-transcript.ptah-ui.spec.ts` [B/C].
- Files:
  - CREATE `...\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-turns.ts` (+ `.spec.ts`)
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.change-set.spec.ts`
  - CREATE `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.ptah-ui.spec.ts` [B/C]

### 5. Zero-model-token / no-host-data boundary fixture [A, extended in C]

- Purpose: Req 1.5 and 5.12 at the three boundaries.
- Fixture:
  - Text with a `ptah-ui` block binding `$diff`, `$tests` and `$usage`, plus the prose "All tests passed and 3 files
    changed".
  - Sentinels: `zz_sentinel_610.ts`, cost `0.610610`, duration `610610`, and a tests label sentinel.
- Assertions:
  - (1) the text `ExecutionNode.content` is byte-identical;
  - (2) the serialized `ChatContinueParams` from `MessageSenderService` contains no sentinel (Electron config);
  - (3) `SdkQueryOptionsBuilder.build` prompt plus `systemPrompt.append` contain no sentinel.
- PR A covers the tests-row and change-set sentinels. PR C adds the fence-bound values.
- Verified contracts: `ChatContinueParams` (`rpc-chat.types.ts:124-159`); `build()` (`:972`), return (`:1758-1762`);
  sender `message-sender.service.ts:689`.
- Files:
  - CREATE `...\libs\frontend\chat\src\lib\services\message-sender.host-data.spec.ts`
  - CREATE `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.host-data.spec.ts`

### 6. Fence segmentation and parser [B; `note` in D]

- Purpose: locate fences in raw text, and parse a body per the normative EBNF and lexical table.
- Responsibilities:
  - **`ptah-ui-fence.ts`:**
    - `segmentPtahUi(text): PtahUiSegment[]`, where
      `PtahUiSegment = {kind:'markdown'; key; text} | {kind:'fence'; key; ordinal; raw; body}`.
    - Line-based with outer-fence tracking (backtick or tilde, ≥3, CommonMark).
    - Open line = exactly ```` ```ptah-ui ```` at column 0 after trailing-space removal. Close = exactly ```` ``` ````.
    - Unclosed fences stay markdown.
  - **`ptah-ui-parser.ts`:**
    - `parsePtahUi(body): {ok:true; doc} | {ok:false; failure: {code; message; line?}}`.
    - Caps first (8,192 UTF-8 bytes, 200 lines). Then trailing-space removal, the column rules, the escapes and the
      `scalar`/`cell` disjointness (bare `$` excluded from `cchar`).
    - `PTAH_UI_SOURCES` table check (`diff`, `tests`, `usage`; Req 3.3; `$context` unknown). Placement rules, `cols`
      checks, element counts.
- Dependencies: none (zod-free).
- Failure behaviour: never throws. Human messages such as ``unknown element `gauge` (line 4)``, plus cap messages
  (Req 2.12).
- Verification seam:
  - One valid and one invalid case per lexical-table row.
  - Every listed fixture (CRLF, three escapes, `\x`, tab, three-space indent, `|` in a title, `$` mid-cell, the empty
    texts, empty table cell, empty stats cell, scalar as a table argument, unknown `cols`, ragged row, `1e3`,
    `1,000`, 8,192/8,193 bytes).
  - The `$diff.files` vs `\$diff.files` pair.
  - Segmentation cases for nested and unclosed fences.
- Files:
  - CREATE `...\libs\shared\src\mcp-apps-contracts\ptah-ui.types.ts`
  - CREATE `...\libs\shared\src\mcp-apps-contracts\ptah-ui-fence.ts` (+ `.spec.ts`)
  - CREATE `...\libs\shared\src\mcp-apps-contracts\ptah-ui-parser.ts` (+ `.spec.ts`)

### 7. Converter, resolver and block pipeline [B; sources completed in C]

- Purpose: parsed doc → internal envelope → host values → validation → a renderable or a fallback reason.
- Responsibilities:
  - **`convertPtahUi(doc, surfaceId): PtahUiConversion`** (ids `c<n>`):
    - `title` → `envelope.title` (`{text:''}` when absent).
    - `stats` → root `stat`s `{title: label, value}`. A scalar keeps `"$src.field"` and adds a binding.
    - Literal `table` → `columns` (`c0..`, label) and string `rows`.
    - `table $src [cols]` → columns and `rows: []`, plus a binding.
    - `list` → `items`; `list $src` → first column, plus a binding.
    - `chart` → `line-chart`/`bar-chart` with one series.
    - `note` [D] → `alert`.
    - No actions, inputs or `data` refs (Req 2.17).
    - Versions come from `SURFACE_SCHEMA_VERSION`/`SURFACE_CATALOG_VERSION` (`surface-catalog.ts:10-11`).
  - **`resolvePtahUi(conversion, snapshot | null): SurfaceContent`** substitutes:
    - `pending` / `unavailable` text (never 0, `$0` or blank);
    - null per-file counts → `unknown`, binary → `binary`;
    - `truncatedCount` / `baselineMissing` / incomplete → `description` notes;
    - empty → `rows: []` plus an empty-state description;
    - cost via `formatUsdCost`, duration via `formatDurationMs`.
    - Literals never merge into source rows (Req 3.2-3.8).
    - PR B always calls it with `null`, so every binding shows `unavailable`.
  - **`renderPtahUiBlock(body, {surfaceId, snapshot, countBytes}): {ok:true; content} | {ok:false; reason}`**: caps →
    parse → convert → resolve → `validateSurfaceDocument`. A throw → `internal error` (Req 2.4).
  - Exports go in `surface.index.ts`.
- Verified contracts: `validateSurfaceDocument` (spot-checked), `SurfaceEnvelope`, display props, `SurfaceIdSchema`,
  `SURFACE_LIMITS` (evidence A3/A4).
- Failure behaviour: atomic; any failure → whole-block fallback (Req 2.3). A budget breach names the budget.
- Verification seam:
  - Converter per-element deep-equal fixtures (2.2).
  - Resolver state matrix (3.2-3.8).
  - Pipeline trust specs (2.3, 2.8: markdown, HTML, URL and entity literals stay literal; no `url`/`actions` keys),
    caps (2.12), unknown source (3.3).
  - Compactness: corpus of ≥6 cases, fence vs `JSON.stringify(conversion)`, `gpt-tokenizer` counts, fence smaller
    (5.13).
- Files:
  - CREATE `...\libs\shared\src\mcp-apps-contracts\ptah-ui-converter.ts` (+ `.spec.ts`)
  - CREATE `...\libs\shared\src\mcp-apps-contracts\ptah-ui-resolver.ts` (+ `.spec.ts`)
  - CREATE `...\libs\shared\src\mcp-apps-contracts\ptah-ui-pipeline.ts` (+ `.spec.ts`)
  - CREATE `...\libs\shared\src\mcp-apps-contracts\ptah-ui.corpus.ts`
  - CREATE `...\libs\shared\src\mcp-apps-contracts\ptah-ui-compactness.spec.ts`
  - MODIFY `...\libs\shared\src\mcp-apps-contracts\surface.index.ts`

### 8. Renderer: omit empty title [B]

- Purpose: a block without `title` must not render an empty `<h2>`.
- Responsibility: `@if (title())` around the `<h2>` (`surface-renderer.component.ts:190-192`). The Apps page is
  unchanged for non-empty titles.
- Verification seam: a renderer spec case. Existing specs stay green.
- Files:
  - MODIFY `...\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.ts`
  - MODIFY/CREATE `...\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.spec.ts` (A-9)

### 9. `ptah-ui` lazy entry: message text host, block, live window [B; snapshots fed in C]

- Purpose: render segmented text with in-place blocks, fallbacks and reason lines, under the live cap.
- Responsibilities:
  - **`PtahUiMessageTextComponent`:**
    - Inputs `text`, `messageId`, `nodeId`, `orderKey`, `active`, `snapshot` [C].
    - `@for (seg of segments(); track seg.key)`. Markdown segments use
      `<markdown [data]="seg.text | surfaceMarkdown: active()">`, as at `execution-node.component.ts:136-138`.
  - **`PtahUiBlockComponent`:**
    - `surfaceId = 'ptah-ui-' + sanitize(nodeId) + '-' + ordinal` (≤128 characters).
    - `result = renderPtahUiBlock(...)` with `utf8JsonBytes = v => new TextEncoder().encode(JSON.stringify(v)).length`.
    - On ok: `<ptah-surface-renderer [renderable]>` with no outputs bound.
    - On failure: `<markdown [data]="raw">`, plus
      `<p data-ptah-ui-reason class="text-xs text-base-content-muted" [id]>Not rendered: {{reason}}</p>`, plus
      `aria-describedby`.
    - `renderFailed` → fallback "could not display".
    - It registers with `PtahUiLiveWindow` and renders snapshot mode when not live.
    - A `snapshot` input change updates in place (Req 3.2).
    - It emits nothing to services (Req 2.5, 2.17).
  - **`PtahUiLiveWindow`:**
    - Main `chat-ui` barrel (eager, provided by the transcript), `@Injectable()`, not root.
    - `register(key, orderKey): Signal<boolean>`. A bounded list of up to 512 keys; no timers or observers.
    - `liveCount(): number` is a read-only seam used by the instrumented test and by no production caller.
    - `PTAH_UI_LIVE_CAP = 8`.
  - **`PTAH_UI_BLOCK_PIPELINE`:** an `InjectionToken` in the lazy entry, `providedIn: 'root'`, factory
    `() => renderPtahUiBlock`. The block calls the pipeline through it, so a spec can count resolve runs. This follows
    the `SURFACE_VIEW_MODEL_BUILDER` precedent (evidence A1).
- Verified contracts: renderer inputs (A1), `SurfaceMarkdownPipe` (`surface-markdown.pipe.ts:10-17`, read), the
  secondary-entry pattern.
- Dependencies: `chat-ui` → `declarative-dashboard`, `shared/mcp-apps-contracts/surface`, `ngx-markdown`,
  `@ptah-extension/markdown` (lattice-allowed, B6).
- Failure behaviour: per-block containment; the other segments render.
- Quality: one pipeline run per snapshot change, no per-block timers or observers, and snapshot change detection
  detached.
- Verification seam (component specs):
  - 2.3: fallback HTML identical to a normal fence.
  - 2.4: a throwing pipeline stub.
  - 2.5: the reason is outside `<code>`, copy text excludes it (A-5), and `aria-describedby` is present.
  - 2.6: open fence = code; close → one instance; unclosed at turn end stays code.
  - 2.7: an instantiation counter across 50 chunks, theme toggles and parent updates = 1.
  - 2.17 and keyboard: Tab order reaches the sort controls with no trap.
  - 5.4, an **instrumented live-cap test** in `ptah-ui-live-window.spec.ts` plus `ptah-ui-block.component.spec.ts`:
    - A test harness renders 12 blocks in one transcript-scoped injector.
    - It records three things per block:
      - (a) `PtahUiLiveWindow.liveCount()`, a read-only test seam returning the number of keys currently live;
      - (b) whether the block's `ChangeDetectorRef.detach` was called (spy) and that `reattach` never was;
      - (c) how many times the block's resolve computation ran after a `snapshot` input change, using a counter on
        the injected `renderPtahUiBlock` stub.
    - It asserts the decision-10 invariant:
      - `liveCount() <= 8` after every insertion;
      - blocks 1-4 are snapshots, with detach called, 0 recomputations after a snapshot change, and an `inert`
        ancestor so no focusable control is reachable;
      - blocks 5-12 are live.
    - It then destroys and recreates blocks 1, 6 and 12 (a render-window remount). Block 1 stays a snapshot, blocks 6
      and 12 stay live, and the invariant still holds.
    - Each snapshot keeps a text alternative.
  - axe for each element in the pending, unavailable, empty, fallback and snapshot states, both themes. Charts have an
    accessible name and a text alternative.
- Files:
  - CREATE `...\libs\frontend\chat-ui\src\ptah-ui.ts`
  - CREATE `...\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-message-text.component.ts` (+ `.spec.ts`)
  - CREATE `...\libs\frontend\chat-ui\src\lib\organisms\ptah-ui\ptah-ui-block.component.ts` (+ `.spec.ts`)
  - CREATE `...\libs\frontend\chat-ui\src\lib\services\ptah-ui-live-window.ts` (+ `.spec.ts`)
  - MODIFY `...\libs\frontend\chat-ui\src\index.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\tsconfig.base.json`

### 10. Execution-node and bubble wiring with the Electron gate [B; snapshot in C]

- Purpose: route top-level assistant text on Electron to the lazy host only when a fence line exists.
- Responsibilities:
  - Eager `ptah-ui-fence-line.ts`: `hasPtahUiFenceLine(text)` = `/^```ptah-ui[ ]*\r?$/m.test(text)`. Zero imports.
  - `ExecutionNodeComponent`:
    - `ptahUi = input<PtahUiNodeContext | null>(null)`, where `PtahUiNodeContext = { messageId; orderKey; snapshot }`.
    - The context is forwarded only in the `@case ('message')` loop (`:249-262`), never in `agent` (`:239-246`) or
      tool recursions (`:176, :205`).
    - The `text` branch:
      `@if (ptahUi() && hasPtahUiFenceLine(renderedContent())) { @defer (on immediate) {…} @placeholder {<markdown>} @error {<markdown>} } @else {<markdown>}`.
  - `MessageBubbleComponent`:
    - New inputs `ptahUiOrderKey` [B] and `ptahUiSnapshot` [C].
    - Context = `null` unless `role === 'assistant'` **and** `inject(VSCodeService).isElectron` (decision 2).
- Verified contracts: the template and inputs (spot-checked), the bubble mount (spot-checked),
  `VSCodeService.isElectron` (`vscode.service.ts:171`, `electron-only-surface.guard.ts:19-20`).
- Failure behaviour: chunk failure → `@error` markdown (Req 2.4).
- Verification seam: `execution-node.ptah-ui.spec.ts`:
  - **VS Code regression [user scope]:** with `isElectron=false` and a valid ```` ```ptah-ui ```` block, the output is
    the ordinary code block, with no reason line, no `ptah-ui-*` element and no deferred dependency load.
  - 2.10 scope: user message, subagent text, thinking, `sendMessage`-nested agent text and non-chat
    `ptah-markdown-block` stay code with no reason.
  - 2.9 trust: HTML imitating `ptah-ui-*` tags or `data-ptah-ui-*`, plus a ```` ```ptah-ui-x ```` or indented fence,
    produce no surface. The existing `provide-markdown-rendering.spec.ts` is unchanged.
  - 5.2: no deferred load without a fence line.
- Files:
  - CREATE `...\libs\frontend\chat\src\lib\components\organisms\execution\ptah-ui-fence-line.ts`
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\execution\execution-node.component.ts`
  - CREATE `...\libs\frontend\chat\src\lib\components\organisms\execution\execution-node.ptah-ui.spec.ts`
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.ts`
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html`

### 11. Hint flag plumbing and host fact [B] [lane-proposed]

- Purpose: carry "this session's transcript renders fences" from the Electron webview to the prompt builder, and
  establish the trusted host fact (decision 8).
- Host fact (batch B8c):
  - Add `HOST_KIND: Symbol.for('HostKind')` to `TOKENS` in `libs/backend/vscode-core/src/di/tokens.ts`, plus the
    exported type `HostKind = 'vscode' | 'electron' | 'cli' | 'tui'` in the same file.
  - `apps/ptah-electron/src/di/phase-1-infra.ts` registers `{ useValue: 'electron' }`.
  - The pinning spec is `apps/ptah-electron/src/di/container.smoke.spec.ts` (MODIFY): the Electron container resolves
    `TOKENS.HOST_KIND` to `'electron'`.
- Responsibilities:
  - `ChatStartParams.ptahUiFence?: boolean` (`rpc-chat.types.ts` beside `:66`) and `ChatContinueParams.ptahUiFence?`
    (`:124-159`).
  - `AISessionConfig.ptahUiFence?: boolean` (`ai-provider.types.ts` beside `:161`).
  - zod `ptahUiFence: z.boolean().optional()` at `chat-rpc.schema.ts:61, 75`.
  - Forwarded wherever `mcpToolProfile` is (`chat-session.service.ts:122, 157, 567, 745, 1429`;
    `chat-slash-command-router.service.ts:127-128`; A-7).
  - `MessageSenderService` adds `...(this.vscode.isElectron ? { ptahUiFence: true } : {})` to `chat:start` (`:440`)
    and `chat:continue` (`:689`).
- Failure behaviour:
  - A missing or false flag → no hint. A missing host token → no hint.
  - zod rejects non-boolean values through the existing RPC error path.
- Verification seam:
  - `chat-rpc.schema.spec.ts` (MODIFY): accept `true`, `false` and absent; reject `"yes"` for start and for continue.
  - `chat-session.ptah-ui-flag.spec.ts` (CREATE): the flag reaches `AISessionConfig` on start and on continue.
  - `chat-continue-slash-before-resume.spec.ts` (MODIFY): the flag survives the slash-command route.
  - `message-sender.service.spec.ts` (MODIFY): Electron sends `true`; with `isElectron=false` the key is absent.
  - `container.smoke.spec.ts` (MODIFY): Electron resolves `HOST_KIND`.
- Files, by batch:
  - **B8a** (shared, rpc-handlers; 4 files):
    - MODIFY `...\libs\shared\src\lib\types\rpc\rpc-chat.types.ts`
    - MODIFY `...\libs\shared\src\lib\types\ai-provider.types.ts`
    - MODIFY `...\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.schema.ts`
    - MODIFY `...\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.schema.spec.ts`
  - **B8b** (rpc-handlers; 4 files):
    - MODIFY `...\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
    - MODIFY `...\libs\backend\rpc-handlers\src\lib\chat\session\chat-slash-command-router.service.ts`
    - CREATE `...\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.ptah-ui-flag.spec.ts`
    - MODIFY `...\libs\backend\rpc-handlers\src\lib\chat\session\chat-continue-slash-before-resume.spec.ts`
  - **B8c** (vscode-core, ptah-electron; 3 files):
    - MODIFY `...\libs\backend\vscode-core\src\di\tokens.ts`
    - MODIFY `...\apps\ptah-electron\src\di\phase-1-infra.ts`
    - MODIFY `...\apps\ptah-electron\src\di\container.smoke.spec.ts`
  - **B7** (chat):
    - MODIFY `...\libs\frontend\chat\src\lib\services\message-sender.service.ts`
    - MODIFY `...\libs\frontend\chat\src\lib\services\message-sender.service.spec.ts`

### 12. System-prompt hint [B; text extended in C, D]

- Purpose: the ≤100-token hint, for Electron coding sessions only (Req 2.14, 5.11, narrowed by [user]).
- Responsibilities:
  - `PTAH_UI_FENCE_HINT` (per-PR text).
  - `AssembleSystemPromptInput.ptahUiHint?: boolean` (`:234-262`) gates one push after `:310`.
  - `SdkQueryOptionsBuilder` gains the last optional constructor parameter
    `@inject(TOKENS.HOST_KIND, { isOptional: true }) private readonly hostKind?: HostKind`.
  - The `assembleSystemPrompt({...})` literal at `:1693` gains exactly:
    `ptahUiHint: this.hostKind === 'electron' && (sessionConfig?.mcpToolProfile ?? 'coding') === 'coding' && sessionConfig?.ptahUiFence === true`.
- Verified contracts: `assembleSystemPrompt` (`:295-330`, spot-checked).
- Failure behaviour: default false.
- Quality: `encode(PTAH_UI_FENCE_HINT).length <= 100`, and no other `ptah-ui` or catalog text in the default prompt.
  The `ptah-core-prompt.spec.ts` 4000-token pin is unaffected.
- Verification seam:
  - `sdk-query-options-builder.ptah-ui-hint.spec.ts` (CREATE) pins the expression with a truth table, built through
    the existing positional-stub construction:

    | `hostKind` | `mcpToolProfile` | `ptahUiFence` | Hint |
    | --- | --- | --- | --- |
    | `'electron'` | absent | `true` | present |
    | `'electron'` | `'coding'` | `true` | present |
    | `'electron'` | `'apps'` | `true` | **absent** |
    | `'electron'` | `'coding'` | absent or `false` | absent |
    | `undefined` (VS Code, TUI, CLI) | `'coding'` | **spoofed `true`** | **absent** |
    | `'vscode'` | `'coding'` | **spoofed `true`** | **absent** |
    | `'tui'` / `'cli'` | `'coding'` | **spoofed `true`** | **absent** |

  - `ptah-ui-hint.spec.ts` (CREATE) checks three things:
    - `assembleSystemPrompt` with `ptahUiHint: true` contains the hint exactly once, directly after
      `PTAH_CORE_SYSTEM_PROMPT`;
    - without the field it is absent (the CLI-lane path);
    - the `gpt-tokenizer` count is ≤100 and no other `ptah-ui`/catalog text appears.
- Files (batch B9; agent-sdk; 5 files):
  - CREATE `...\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.ts`
  - CREATE `...\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-ui-hint.spec.ts`
  - MODIFY `...\libs\backend\agent-sdk\src\lib\prompt-harness\index.ts`
  - MODIFY `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
  - CREATE `...\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ptah-ui-hint.spec.ts`

### 13. `ptah-surface-authoring` skill, `ptah-ui` section [B; updated C, D, E]

- Responsibilities:
  - `SKILL.md`, if absent.
  - `references/ptah-ui.md`: EBNF, lexical table, source table (no `$context`), caps, fallback, and six worked
    examples from the corpus.
  - `npm run manifest:generate`.
- Verification seam: `manifest:check`. The hint spec asserts the skill name.
- Files:
  - CREATE `...\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\SKILL.md` (if absent)
  - CREATE `...\apps\ptah-extension-vscode\assets\plugins\ptah-core\skills\ptah-surface-authoring\references\ptah-ui.md`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\content-manifest.json`

### 14. Catalog additions [D] (after TASK_2026_594, at `dashboard-catalog/3`) [user, Gate 2]

- Purpose: add the static text kind and the fence `note`, with a single catalog bump.
- Responsibilities:
  - Display kind `text-block` `{ id, kind: 'text-block', text: RichText, role: 'heading' | 'body' }`. `text` is
    already an input kind (`surface-catalog.ts:29-34`).
  - It is added to the catalog kinds, types, zod schema and text fallback **at `dashboard-catalog/3`**.
    `SURFACE_CATALOG_VERSION` must already equal `'dashboard-catalog/3'` from 594 (A-11), and D1 does not change it.
  - The renderer mapping is in D2. The fence `note` → 594 `alert` is in D3 (A-8).
- Verification seam:
  - `surface-contract.spec.ts`: accept `text-block`; reject an unknown `role`, empty or over-length text, and extra
    keys. The catalog version equals `'dashboard-catalog/3'`.
  - `surface-text-fallback.spec.ts`: a heading or body line is printed.
  - Renderer spec (D2). `note` parser/converter fixtures and corpus entries (D3).
- Files, D1 (shared; exactly 6; **confirm after 594 lands**):
  - MODIFY `...\libs\shared\src\mcp-apps-contracts\surface-catalog.ts`
  - MODIFY `...\libs\shared\src\mcp-apps-contracts\surface.types.ts`
  - MODIFY `...\libs\shared\src\mcp-apps-contracts\surface.schemas.ts`
  - MODIFY `...\libs\shared\src\mcp-apps-contracts\surface-text-fallback.ts`
  - MODIFY `...\libs\shared\src\mcp-apps-contracts\surface-contract.spec.ts`
  - MODIFY `...\libs\shared\src\mcp-apps-contracts\surface-text-fallback.spec.ts`
- D2 and D3 file lists are derived from 594's merged renderer and parser layout before they start (≤6 each).

### 15. Eager-closure bundle gate [A; patterns extended in B] (Req 5.1, 5.2, 5.9)

- Purpose: a checked-in, failing check that no fence or renderer module enters the webview's initial (eager) closure,
  plus a growth check against the base build.
- Responsibilities:
  - **Script** `scripts/eager-closure-gate.js` (CommonJS, like `electron-only-chunks.js`):
    - `forbiddenOutputs(stats, patterns): string[]`. These are the output files whose
      `stats.outputs[file].inputs` keys match any forbidden pattern.
    - `assertNoForbiddenEager(stats, patterns)`. It **reuses** `assertEagerClosureKept(stats, forbiddenOutputs(...))`
      from `scripts/electron-only-chunks.js:154-173`. That function walks `main.js` `import-statement` imports and
      throws when the closure, including `main.js` itself, reaches a listed file. The gate re-throws with its own
      message naming the forbidden inputs.
    - `eagerInputs(stats): Set<string>`, the union of `inputs` over the same closure. `assertNoUnlistedEagerGrowth(head,
      base, allowPatterns)` fails when an eager input exists in head, is absent from base, and matches no allow
      pattern.
    - CLI: `node scripts/eager-closure-gate.js <head-stats.json> [--base <base-stats.json>]`. It exits 1 on any
      violation and prints the offending inputs and files.
  - **Forbidden patterns** (`FORBIDDEN_EAGER_INPUTS`, in the script):
    - `libs/frontend/declarative-dashboard/`;
    - `libs/shared/src/mcp-apps-contracts/`, which covers the fence parser, converter, resolver, pipeline and
      validator;
    - `libs/frontend/chat-ui/src/ptah-ui.ts` and `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/`;
    - `libs/frontend/chat-ui/src/lib/molecules/turn-recap/`;
    - `/charts/` under `declarative-dashboard`;
    - `node_modules/zod/`, only when reached through the above. Evidence D5 shows zod is already eager through other
      inputs on `main` (95 files both trees), so zod is enforced by the growth check, not by the forbidden list.
  - **Allow patterns** for new eager inputs:
    - `chat/.../execution/ptah-ui-fence-line.ts`;
    - `chat-ui/src/lib/services/ptah-ui-live-window.ts`;
    - `chat/.../transcript/transcript-turns.ts`;
    - `shared/src/lib/utils/{test-command-matcher,turn-tests.utils,turn-sources.utils,usage-format.utils}.ts`;
    - the edited existing files.
  - npm script `"gate:eager-closure": "node scripts/eager-closure-gate.js dist/apps/ptah-extension-webview/stats.json"`
    in the root `package.json`.
- Verification seam: `apps/ptah-electron/src/config/eager-closure-gate.spec.ts` (precedent:
  `packaged-deps.spec.ts:69,215` tests `electron-only-chunks.js`).
  - **(a)** Synthetic stats fixtures:
    - a forbidden input inside `main.js` throws;
    - one in a statically imported chunk throws;
    - one only in a dynamically imported chunk passes;
    - a new unlisted eager input with `--base` throws.
  - **(b)** The real build, via `describeIfBuiltOrFail` (`apps/ptah-electron/src/config/build-artifact-gate.ts:33`),
    over `dist/apps/ptah-extension-webview/stats.json` (`statsJson: true`, evidence D5). It asserts no forbidden eager
    input.
  - Each PR also records `node scripts/eager-closure-gate.js <head> --base <f314a4f8a stats>` output in
    `measurement.md`, with the base built per evidence D5 (Electron only [user]).
- Failure behaviour: the gate fails closed. A missing `stats.json` fails unless `PTAH_ALLOW_SKIP_UNBUILT=1`, the
  existing `build-artifact-gate.ts` convention.
- Files (batch A6; 3 files):
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\scripts\eager-closure-gate.js`
  - CREATE `...\apps\ptah-electron\src\config\eager-closure-gate.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\package.json`

### 16. Host-source registry contract test [A; re-run every PR] (Req 1.13)

- Purpose: prove that no RPC method or push message was added to expose `$diff`, `$tests` or `$usage`.
- Responsibilities:
  - A baseline fixture `host-source-registry.baseline.ts` holds two sorted arrays captured at merge-base `f314a4f8a`:
    - `RPC_METHOD_NAMES` (`libs/shared/src/lib/types/rpc.types.ts:4122`);
    - `Object.values(MESSAGE_TYPES)` (`libs/shared/src/lib/types/messages/message-constants.ts:18`).
  - The spec asserts that the current arrays deep-equal the baseline: no method or push added or removed.
  - The only allowed delta is the optional `ptahUiFence` field on the existing `chat:start`/`chat:continue` params.
    That is a field, not a method or push, and it is pinned separately by `chat-rpc.schema.spec.ts` (B8a), which
    asserts the schema key set equals the base key set plus `ptahUiFence`.
  - Updating the baseline requires a Gate 2 exception entry in this plan (Req 1.13). The spec header says so.
- Failure behaviour: any registry change fails `nx test shared`.
- Files (batch A7; shared; 2 files):
  - CREATE `...\libs\shared\src\lib\types\rpc\host-source-registry.baseline.ts`
  - CREATE `...\libs\shared\src\lib\types\rpc\host-source-registry.contract.spec.ts`

## Integration architecture

- **Data flow (Electron webview):**
  1. The stream fills the text node. `renderedContent()` mirrors it per frame.
  2. The bubble has a context (`isElectron`, assistant role).
  3. `hasPtahUiFenceLine`.
  4. `@defer` loads the `chat-ui/ptah-ui` chunk.
  5. `segmentPtahUi`.
  6. For each closed fence, `renderPtahUiBlock`: caps → parse → convert → `resolvePtahUi` with the transcript snapshot
     → `validateSurfaceDocument`.
  7. `SurfaceRendererComponent`, or the identical code block plus a reason line.
- **Host sources:**
  - `ChangeSetStore.changeSetsFor` + `changeSetForMessage` → `diff`.
  - The turn's assistant trees + `collectTurnTests` → `tests`.
  - The block message's tokens, cost and duration → `usage`.
  - `streamingBoundary` → pending or terminal.
  - Everything is recomputed from persisted change sets and stored trees on remount (3.7).
- **VS Code:** context `null`. Unchanged markdown path, no tests row, no flag, no hint.
- **Hint:** Electron `MessageSenderService` → `ptahUiFence` → zod → `AISessionConfig`. Separately, the Electron DI
  registers `TOKENS.HOST_KIND = 'electron'`. Both reach `buildSystemPrompt`, which evaluates the L-7 expression at
  `:1693` → `assembleSystemPrompt` → `PTAH_UI_FENCE_HINT`.
- **A2UI:** deferred with PR E [user].
- **State:**
  - No new persisted state; message text is never rewritten (3.9).
  - `PtahUiLiveWindow` is tab-scoped in memory.
  - The `ptahUiFence` flag lives in the in-memory `AISessionConfig`, re-sent on every continue.
- **External boundaries:**
  - Fence text: caps, parser, `validateSurfaceDocument`; plain text only.
  - `ptahUiFence`: zod boolean, caller-controlled, so it is never sufficient on its own. The trusted half of the hint gate is `TOKENS.HOST_KIND` (L-7).
  - Nothing from a block reaches the host or the agent.
- **Failure and rollback:**
  - Block-local fallback; chunk failure falls back to markdown.
  - Every PR can be reverted alone. PR B is inert without a fence line and on VS Code.
- **Observability:**
  - The reason line.
  - `measurement.md` per PR, **Electron only** [user]: initial-chunk report (5.1), the no-fence chunk log (5.2), the
    coding `tools/list` on the Electron-like host by hash (5.10), hint text, chars and tokens (5.11), corpus figures
    (5.13), and the `eager-closure-gate` `--base` output.

## Architecture-level quality requirements

- **Functional:** Req 1 (except 1.9), 2 (except 2.16), 3 and 5 hold (Req 4 deferred) in the Electron webview. VS Code is byte-for-byte
  unchanged for messages containing fences.
- **Performance:**
  - The initial chunk set excludes `declarative-dashboard`, `mcp-apps-contracts`, zod reached through these, and the
    chart code.
  - The named eager additions are `ptah-ui-fence-line.ts`, `PtahUiLiveWindow`, `transcript-turns.ts`, and the shared
    `test-command-matcher`/`turn-tests`/`turn-sources`/`usage-format`.
  - No chunk request without a fence line, or on VS Code.
  - At most 8 live blocks per tab.
- **Security:**
  - The sanitiser is unchanged and there is no forgeable marker.
  - Fences are plain text with no actions or inputs.
  - The hint gate is backed by a trusted host fact (L-7).
  - Trust specs for 2.3, 2.8 and 2.9. Those for 4.2, 4.9 and 4.11 move with PR E.
- **Maintainability:**
  - The lattice is unchanged; `markdown` is untouched.
  - The shared main barrel stays zod-free (`index.zod-free.spec.ts`).
  - Barrels ≤150 lines.
  - The new session flag mirrors `mcpToolProfile` at every site.
- **Testability:** pure seams (matcher, parser, converter, resolver, pipeline, adapter) plus thin component specs.

### Requirement → test map

| Req | Spec (component, batch) |
| --- | --- |
| 1.1, 1.4, 1.12, VS Code no-row | `chat-transcript.change-set.spec.ts` (4, A4) |
| 1.2 | `test-command-matcher.spec.ts`, `turn-tests.utils.spec.ts` (1, A1) |
| 1.3 | badge specs unchanged plus `usage-format.utils.spec.ts` (2, A2/A3) |
| 1.5, 5.12 | `message-sender.host-data.spec.ts`, `sdk-query-options-builder.host-data.spec.ts` (5, A5; extended C4) |
| 1.6-1.8 | (1), `transcript-turns.spec.ts`, `turn-tests-row.component.spec.ts` (3, 4; A3/A4) |
| 1.11 (Electron) | (3) both themes, plus a manual Electron check in QA |
| **1.13** | `host-source-registry.contract.spec.ts` (16, **A7**): method and push registries equal the `f314a4f8a` baseline. `chat-rpc.schema.spec.ts` (B8a): param key set = base + `ptahUiFence`. Both re-run on every PR. |
| Grammar, 2.12 | `ptah-ui-parser.spec.ts`, `ptah-ui-fence.spec.ts` (6, B1) |
| 2.1, 2.2, 2.8, 2.11, 3.3 | converter and pipeline specs (7, B2/B3) |
| 2.3-2.7, 2.13, 2.17 | block and message-text specs (9, B5) |
| **5.4** | the instrumented live-cap test in `ptah-ui-live-window.spec.ts` + `ptah-ui-block.component.spec.ts` (9, B5): 12 blocks plus remounts, invariant of decision 10 |
| 2.9, 2.10, 5.2, **VS Code fence stays code [user]** | `execution-node.ptah-ui.spec.ts` (10, B6) |
| 2.14, 5.11, **Electron-only hint [user]** | `sdk-query-options-builder.ptah-ui-hint.spec.ts` truth table (spoofed `true` on a non-Electron host → absent; `apps` profile → absent), `ptah-ui-hint.spec.ts` (12, B9); `chat-rpc.schema.spec.ts`, `chat-session.ptah-ui-flag.spec.ts`, `chat-continue-slash-before-resume.spec.ts` (11, B8a/B8b); `container.smoke.spec.ts` (B8c); `message-sender.service.spec.ts` (B7) |
| 2.15 | `manifest:check` (13, B10) |
| 3.1-3.8 | resolver spec (7, C1), `chat-transcript.ptah-ui.spec.ts` (4, B7/C2) |
| 3.10 | parser rejects `$context` (6, B1) |
| **5.1, 5.2, 5.9** | `eager-closure-gate.spec.ts` plus `npm run gate:eager-closure` (15, **A6**), failing on a forbidden eager input or unlisted eager growth. The `--base` output goes to `measurement.md` (Electron). |
| 5.8, 5.10, 5.13 | the tests row mounted only on finalized turns (4); coding `tools/list` on the Electron-like host in `measurement.md`; compactness spec (7, B3) |
| 4.x | deferred with PR E [user] |
| NFR a11y | axe in (3), (9); keyboard fixture in (9) |

## Lane-introduced constraints

- **L-1 [lane-proposed]** Fences are recognised by splitting raw text before markdown, in `chat`/`chat-ui`. No change
  to `libs/frontend/markdown`.
- **L-2 [lane-proposed]** The fence pipeline lives in `libs/shared/src/mcp-apps-contracts/ptah-ui-*.ts`, exported only
  from `surface.index.ts`. Its only consumer for now is the Electron webview.
- **L-3 [lane-proposed]** Host sources are applied by literal substitution. The 5.13 canonical JSON is
  `JSON.stringify(PtahUiConversion)` with `$src.field` placeholders.
- **L-4 [lane-proposed]** `$context` is dropped (Req 3.10 outcome).
- **L-5 [lane-proposed]** `PTAH_UI_LIVE_CAP = 8` = `SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId` (`8`,
  `surface-catalog.ts:147`). Live blocks per tab ≤ 8. A snapshot has no source reads, a detached detector and an
  `inert` subtree, with a hidden text alternative.
- **L-6 [lane-proposed]** The Electron gate for fence rendering, the tests row and host sources is
  `VSCodeService.isElectron`, the same source of truth as `electronOnlySurface`. It is read in the bubble and the
  transcript.
- **L-7 [lane-proposed]** The hint is sent iff
  `hostKind === 'electron' && (mcpToolProfile ?? 'coding') === 'coding' && ptahUiFence === true`.
  - It is computed in `buildSystemPrompt` at the `assembleSystemPrompt({...})` literal
    (`sdk-query-options-builder.ts:1693`).
  - `hostKind` is a trusted DI value, `TOKENS.HOST_KIND`, registered only by the Electron app (`phase-1-infra.ts`).
  - `ptahUiFence` is an optional zod boolean on `chat:start`/`chat:continue`, sent by the Electron webview. It only
    narrows within Electron and grants nothing elsewhere.
- **L-8 [lane-proposed]** The cost and duration formatters move to shared utils.
- **L-9 [lane-proposed]** `SurfaceRendererComponent` omits an empty `<h2>`.
- **L-10 [lane-proposed]** The static text kind is named `text-block` and is added at `dashboard-catalog/3` with no
  version change [user, Gate 2: one bump]. `note` maps to 594's `alert`.
- **L-11 [lane-proposed]** `$diff` uses the turn window containing the block's message. `$tests` uses every assistant
  message of the turn. `$usage` uses the block's own message.
- **L-12 [lane-proposed]** Token-budget specs call `gpt-tokenizer` `encode` directly (4.0.0, already a root
  dependency, `package.json:169`).
- **L-13 [lane-proposed]** Pure-TS `libs/shared` batches go to Codex lanes. This is execution routing, not a product
  rule.
- **L-14 [lane-proposed]** Block surface ids are `ptah-ui-<sanitised nodeId>-<ordinal>`, ≤128 characters.
- **L-16 [lane-proposed]** A checked-in eager-closure gate (`scripts/eager-closure-gate.js`, reusing
  `assertEagerClosureKept`) fails on forbidden eager inputs and unlisted eager growth.
- **L-17 [lane-proposed]** The RPC method and push registries are pinned to a `f314a4f8a` baseline. Changing it needs
  a Gate 2 exception (Req 1.13).

L-15 (A2UI commit) is withdrawn with PR E.

## Gate 2 decisions recorded [user]

1. The static text kind and the note kind go into TASK_2026_594's `dashboard-catalog/3`. There is one catalog bump.
   D1 depends on 594 merged at exactly that version.
2. PR E is removed from this approval. It returns through a separate Gate 2 amendment after the Req 4.1 raw-schema
   check.

## Team-leader handoff

- **Recommended executors:**
  - Codex lanes: shared pure-TS batches (L-13), backend batches (`rpc-handlers`, `agent-sdk`, `vscode-core`), the
    Electron DI change, and scripts.
  - opencode lanes: Angular batches (`chat`, `chat-ui`, `declarative-dashboard`).
  - The `code-logic-reviewer` and `code-style-reviewer` subagents review lane code. Component 10 is checked against
    TASK_2026_532 defects 1-6. Components 11 and 12 are checked against the L-7 truth table.
- **Complexity:** HIGH. A normative grammar, a security-relevant mount, an Electron gate in a shared webview, a
  trusted host fact, and sequencing behind 594.
- **Component ordering:**
  - 1 → 2 → 3 → 4(A) → 5. Components 15 and 16 are independent in PR A.
  - 6 → 7 → 9 (with 8) → 10 → 4(B).
  - 11 → 12, independent of the webview chain. 13 is independent.
  - PR C revisits 4, 7, 9, 10, 12 and 13.
  - 14 waits for 594 at `dashboard-catalog/3`.

### Batches (≤6 files and ≤2 libs each, specs counted; the team-leader may re-split)

| Batch | PR | Lane | Files | Libs | Depends on | Parallel group |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | A | backend (Codex) | `test-command-matcher.ts`, `.spec.ts`, `test-command.fixtures.ts`, `turn-tests.utils.ts`, `.spec.ts`, `utils/index.ts` | shared | none | G-A1 |
| A2 | A | backend (Codex) | `turn-sources.utils.ts`, `.spec.ts`, `usage-format.utils.ts`, `.spec.ts`, `utils/index.ts` | shared | A1 | none |
| A3 | A | frontend (opencode) | `cost-badge.component.ts`, `duration-badge.component.ts`, `turn-tests-row.component.ts`, `.spec.ts`, `src/turn-recap.ts`, `tsconfig.base.json` | chat-ui (+root config) | A2 | none |
| A4 | A | frontend (opencode) | `transcript-turns.ts`, `.spec.ts`, `chat-transcript.component.ts`, `.html`, `chat-transcript.change-set.spec.ts` | chat | A3 | none |
| A5 | A | backend (Codex) | `message-sender.host-data.spec.ts`, `sdk-query-options-builder.host-data.spec.ts` | chat, agent-sdk | A4 | none |
| A6 | A | backend (Codex) | `scripts/eager-closure-gate.js`, `apps/ptah-electron/src/config/eager-closure-gate.spec.ts`, `package.json` | scripts, ptah-electron | none | G-A1 |
| A7 | A | backend (Codex) | `host-source-registry.baseline.ts`, `host-source-registry.contract.spec.ts` | shared | none (file-disjoint from A1/A2) | G-A1 |
| B1 | B | backend (Codex) | `ptah-ui.types.ts`, `ptah-ui-fence.ts`, `.spec.ts`, `ptah-ui-parser.ts`, `.spec.ts` | shared | PR A merged | G-B1 |
| B2 | B | backend (Codex) | `ptah-ui-converter.ts`, `.spec.ts`, `ptah-ui-resolver.ts`, `.spec.ts`, `ptah-ui-pipeline.ts`, `surface.index.ts` | shared | B1 | (chain in G-B1) |
| B3 | B | backend (Codex) | `ptah-ui-pipeline.spec.ts`, `ptah-ui.corpus.ts`, `ptah-ui-compactness.spec.ts` | shared | B2 | G-B2 |
| B4 | B | frontend (opencode) | `surface-renderer.component.ts`, `surface-renderer.component.spec.ts`, `src/ptah-ui.ts`, `ptah-ui-message-text.component.ts`, `ptah-ui-block.component.ts`, `tsconfig.base.json` | declarative-dashboard, chat-ui | B2 | G-B2 |
| B5 | B | frontend (opencode) | `ptah-ui-live-window.ts`, `.spec.ts`, `chat-ui/src/index.ts`, `ptah-ui-message-text.component.spec.ts`, `ptah-ui-block.component.spec.ts` | chat-ui | B4 | (chain in G-B2) |
| B6 | B | frontend (opencode) | `ptah-ui-fence-line.ts`, `execution-node.component.ts`, `execution-node.ptah-ui.spec.ts`, `message-bubble.component.ts`, `message-bubble.component.html` | chat | B5 | none |
| B7 | B | frontend (opencode) | `chat-transcript.component.ts`, `chat-transcript.ptah-ui.spec.ts`, `message-sender.service.ts`, `message-sender.service.spec.ts` | chat | B6, B8a | none |
| B8a | B | backend (Codex) | `rpc-chat.types.ts`, `ai-provider.types.ts`, `chat-rpc.schema.ts`, `chat-rpc.schema.spec.ts` | shared, rpc-handlers | PR A merged | G-B1 |
| B8b | B | backend (Codex) | `chat-session.service.ts`, `chat-slash-command-router.service.ts`, `chat-session.ptah-ui-flag.spec.ts`, `chat-continue-slash-before-resume.spec.ts` | rpc-handlers | B8a | G-B2 |
| B8c | B | backend (Codex) | `vscode-core/src/di/tokens.ts`, `ptah-electron/src/di/phase-1-infra.ts`, `ptah-electron/src/di/container.smoke.spec.ts` | vscode-core, ptah-electron | PR A merged | G-B1 |
| B9 | B | backend (Codex) | `ptah-ui-hint.ts`, `ptah-ui-hint.spec.ts`, `prompt-harness/index.ts`, `sdk-query-options-builder.ts`, `sdk-query-options-builder.ptah-ui-hint.spec.ts` | agent-sdk | B8a, B8c | G-B2 |
| B10 | B | backend (Codex) | `SKILL.md` (if absent), `references/ptah-ui.md`, `content-manifest.json` | assets | PR A merged | G-B1 |
| C1 | C | backend (Codex) | `ptah-ui-resolver.ts`, `.spec.ts`, `turn-sources.utils.ts`, `.spec.ts` | shared | PR B merged | G-C1 |
| C2 | C | frontend (opencode) | `chat-transcript.component.ts`, `message-bubble.component.ts`, `.html`, `execution-node.component.ts`, `ptah-ui-block.component.ts`, `chat-transcript.ptah-ui.spec.ts` | chat, chat-ui | C1 | none |
| C3 | C | backend (Codex) | `ptah-ui-hint.ts`, `ptah-ui-hint.spec.ts`, `references/ptah-ui.md`, `content-manifest.json` | agent-sdk, assets | PR B merged | G-C1 |
| C4 | C | backend (Codex) | `message-sender.host-data.spec.ts`, `sdk-query-options-builder.host-data.spec.ts` (fence sentinels) | chat, agent-sdk | C2 | none |
| D1 | D | backend (Codex) | `surface-catalog.ts`, `surface.types.ts`, `surface.schemas.ts`, `surface-text-fallback.ts`, `surface-contract.spec.ts`, `surface-text-fallback.spec.ts` (**confirm after 594 lands**) | shared | 594 merged at `dashboard-catalog/3`; PR B merged | G-D1 |
| D2 | D | frontend (opencode) | `text-block` view-model mapping, node component, spec (≤6, derived from 594's layout) | declarative-dashboard | D1 | G-D2 |
| D3 | D | backend (Codex) | `ptah-ui-parser.ts`, `ptah-ui-parser.spec.ts`, `ptah-ui-converter.ts`, `ptah-ui-converter.spec.ts`, `ptah-ui.corpus.ts` | shared | 594 merged; PR B merged | G-D1 |
| D4 | D | backend (Codex) | `ptah-ui-hint.ts`, `ptah-ui-hint.spec.ts`, `references/ptah-ui.md`, `content-manifest.json` | agent-sdk, assets | D3 | G-D2 |

27 batches: A 7, B 12, C 4, D 4. PR E: 0 (deferred [user]).

- **Parallel groups** (file-disjoint within each group):
  - **G-A1** = A1 ∥ A6 ∥ A7. After A1, PR A runs A2→A3→A4→A5 in order.
  - **G-B1** = (B1→B2) ∥ B8a ∥ B8c ∥ B10.
  - **G-B2**, after B2, B8a and B8c: B3 ∥ (B4→B5) ∥ B8b ∥ B9. Then B6 → B7.
  - **G-C1** = C1 ∥ C3. Then C2 → C4.
  - **G-D1** = D1 ∥ D3. **G-D2** = D2 ∥ D4.
  - Edits to `utils/index.ts`, `surface.index.ts` and `tsconfig.base.json` are serialized as listed.
- **Files affected:**
  - CREATE: as listed per component, about 33 new files across `libs/shared`, `libs/frontend/chat-ui`,
    `libs/frontend/chat`, `libs/backend/agent-sdk`, `libs/backend/rpc-handlers`, `apps/ptah-electron`, `scripts` and
    `apps/ptah-extension-vscode/assets`. No files under `apps/ptah-tui` or VS Code-specific code.
  - MODIFY:
    - root: `tsconfig.base.json`, `content-manifest.json`, `package.json`;
    - `shared`: `utils/index.ts`, `surface.index.ts`, `rpc-chat.types.ts`, `ai-provider.types.ts`, and the D1
      catalog files;
    - `chat-ui`: `index.ts` and the two badges;
    - `chat`: `execution-node.component.ts`, `message-bubble.component.ts/.html`,
      `chat-transcript.component.ts/.html`, `chat-transcript.change-set.spec.ts`, `message-sender.service.ts` (+spec);
    - `declarative-dashboard`: `surface-renderer.component.ts` (+spec);
    - `rpc-handlers`: `chat-rpc.schema.ts` (+spec), `chat-session.service.ts`,
      `chat-slash-command-router.service.ts`, `chat-continue-slash-before-resume.spec.ts`;
    - `vscode-core`: `di/tokens.ts`;
    - `ptah-electron`: `di/phase-1-infra.ts`, `di/container.smoke.spec.ts`;
    - `agent-sdk`: `sdk-query-options-builder.ts`, `prompt-harness/index.ts`.
  - REWRITE: none.
- **Verification points:**
  - Re-open each cited line before editing. The relayed, not spot-checked contracts are the A1 renderer outputs and
    the B3/B4 store and anchor lines.
  - Resolve A-1…A-11 in the first batch that depends on each.
  - Per touched project, run `npx nx test|lint|typecheck <project>`. Projects: `shared`, `chat`, `chat-ui`,
    `declarative-dashboard`, `rpc-handlers`, `vscode-core`, `agent-sdk`, `ptah-electron`.
  - Per PR, Electron only [user]:
    - the production webview build with `--stats-json`;
    - `npm run gate:eager-closure`, plus the `--base` run against `f314a4f8a` stats;
    - `host-source-registry.contract.spec.ts`;
    - the coding `tools/list` on the Electron-like host;
    - the hint token count;
    - `npm run manifest:check` when assets change.
  - `libs/shared/src/index.zod-free.spec.ts` stays green.
