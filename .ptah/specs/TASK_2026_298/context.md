# Context

## Where this came from

A design conversation that started as "would generative UI / AG-UI give Ptah
anything real?" and ended somewhere else entirely. Tracing that question through
the participant path surfaced a structural fork that costs correctness,
performance and maintenance today — independently of any protocol decision.

The AG-UI verdict is recorded at the end of this document. It is **not** the
subject of this task.

## The fork

"Participant" has two implementations that diverge at six layers:

| Layer         | Path A — vendor as MODEL                  | Path B — vendor as AGENT                   |
| ------------- | ----------------------------------------- | ------------------------------------------ |
| Discovery     | `buildProviderLanes()`                    | `buildCliFamilyLanes()`                    |
| Identity      | `family: provider.id` → `'openai-codex'`  | `family: cli` → `'codex'`                  |
| Model listing | `provider:listModels`                     | `agent:listCliModels`                      |
| Spawn args    | `ptahCliId: "..."`                        | `cli: "..."`                               |
| Execution     | `TranslationProxyBase` → Claude Agent SDK | `CliAdapter` → `SdkHandle`                 |
| Output        | `FlatStreamEventUnion` (tier 3)           | `CliOutputSegment` / raw string (tier 1–2) |

Both paths already work. Both are already reachable from the tribunal panel.
The distinction between them is meaningful and worth keeping — Path A runs the
vendor's **weights inside Ptah's harness**, Path B runs the vendor's **own
harness, tools and system prompt**. What is not worth keeping is six parallel
expressions of that one distinction.

Every new vendor pays the fork tax six times. Every feature touching
participants branches twice. And a correctness rule that reads one of the six
forks as authoritative silently misreads the other — which is exactly what has
happened.

## Findings, with locations

### 1. The `family` key mismatch is a live correctness bug

- `libs/frontend/tribunal-panel/src/lib/services/tribunal-discovery.service.ts`
  — `buildCliFamilyLanes` sets `family: cli`; `buildProviderLanes` sets
  `family: provider.id`.
- `libs/frontend/tribunal-panel/src/lib/services/tribunal-roster-rules.ts`
  — `validateCrucible` blocks a judge whose `family` equals the executor's, with
  no override, because "a lane grading its own output is not a signal".
  `validateRelay` applies the same reasoning to implement/review.

Today the bug is latent, because finding 2 keeps the two schemes from meeting.
**It becomes live the moment finding 2 is fixed**, so the key must be unified
first. Order matters here.

### 2. Codex and Copilot are structurally denied a model lane

`tribunal-discovery.service.ts` declares
`CLI_FAMILY_PROVIDER_IDS = new Set(['github-copilot', 'openai-codex'])` and
filters those ids out of `buildProviderLanes`.

`CodexTranslationProxy` and `CopilotTranslationProxy` both exist, both work, and
both are wired into `ProviderProxyPool` (`libs/backend/auth-providers/`). The
exclusion reads as a reasonable fix for a real UX problem — not showing "Codex"
twice in the vendor picker — but its effect is that the two vendors where both
integrations are built are the only two where one is unreachable.

Corroborating detail: the Codex **CLI** family entry carries
`modelProviderId: 'openai-codex'`, so its model picker is already populated from
the provider catalogue via `provider:listModels`. The provider entry is trusted
to enumerate Codex's models and not to run one.

Smaller companion effect: `compareVendors` sorts `cli !== 'ptah-cli'` first, so
even un-suppressed provider lanes sit at the bottom of the picker.

### 3. Path is orthogonal to move — there is no routing to fix

`tribunal-run.service.ts` `spawnArgsFor(lane)` switches on `lane.cli`: six arms
emit `cli: "<name>"`, the `ptah-cli` arm emits `ptahCliId: "<id>"`. Both produce
a `ptah_agent_spawn({...})` line in the conductor's framing preamble; the
backend routes on which argument it received.

`validateRoster` constrains on `family` and never on `cli` vs `ptah-cli`.
Council, forge and race return `[]` — no constraints at all.

So the path is a property of the **lane**, chosen by the user in the wizard, and
every move can already run either path. An earlier hypothesis that moves were
routed to paths was wrong and should not be re-derived.

### 4. Double emission on the Path B hot path

`codex-cli.adapter.ts` `handleStreamEvent` fans every vendor event to both
`output.emit` and `segment.emit`. `agent-process-manager.service.ts` subscribes
to `onOutput`, `onSegment` and `onStreamEvent` unconditionally.

Per Codex event, therefore: a string built and ring-buffered (the buffer already
has a cap — see `streamCapLogged`), a segment built and accumulated, both
crossing the postMessage boundary, both deduplicated on the far side. During a
four-tile tribunal that cost is paid four times concurrently, which is precisely
when the webview is most contended.

### 5. `SdkHandle` optionality is the maintenance tax

`cli-adapter.interface.ts` — `SdkHandle` carries nine optional members
(`onSegment?`, `onStreamEvent?`, `getSessionId?`, `setAgentId?`,
`onSessionResolved?`, `supportsContinuation?`, `continue?`, `steer?`,
`getPid?`). Every `?` is a branch in every consumer.

The `onStreamEvent` comment states it plainly: _"Only Ptah CLI adapter
implements this. Enables full ExecutionNode rendering."_ That is the fidelity
asymmetry, declared in the type.

### 6. The tribunal's comparison premise is affected by 1–5

A panel whose purpose is fair vendor comparison currently renders one
participant through a full execution tree and the others through segments or
text. For council that is cosmetic. For forge, race and crucible — where a judge
agent reads the lanes — the judge is systematically better informed about one
participant than the others.

## BLOCKING PREREQUISITE — investigate before deleting anything

**No deletion in this task begins until a dedicated investigation batch has
completed and its findings are recorded here.** This is a hard gate, requested
explicitly. Nothing below is approved for removal on the strength of the
analysis above.

The investigation must answer, with enumerated call sites rather than
inference:

1. **`onStreamEvent`** — every producer and every consumer. What
   `AgentProcessManager.accumulateStreamEvent` does with it, how it reaches the
   webview, and what in `chat-execution-tree` / `chat-streaming` depends on its
   current shape. Whether the "Ptah CLI adapter only" comment is still true or
   has drifted.
2. **`onSegment` / `CliOutputSegment`** — every emitter and every reader,
   including the accumulator, any persistence, any RPC payload that carries a
   segment, and the frontend components that render one. Whether the segment
   vocabulary encodes anything `FlatStreamEventUnion` cannot express. If it
   does, that is a finding that changes the plan, not an obstacle to route
   around.
3. **`onOutput` and the raw stdout buffer** — what reads
   `appendBuffer(agentId, 'stdout', data)`. There is a real possibility this
   feeds a diagnostics, logging or debugging surface with no rendering role, in
   which case it should be kept as an explicit diagnostic channel rather than
   deleted or left as an optional member of the handle. Confirm before assuming.
4. **The other seven optional `SdkHandle` members** — which are genuinely
   per-vendor capability flags (`supportsContinuation`, `steer`, `getPid`) and
   which are accidental optionality that a required contract would absorb.
5. **Per-adapter feasibility of tier 3** — for each of codex, copilot, cursor,
   antigravity, opencode and pi: does the vendor surface enough structure to
   produce `FlatStreamEventUnion`, or must the adapter degrade internally to a
   `message_start` / `text_delta` / `message_complete` triple? Codex is known to
   carry item lifecycle, text deltas and tool items, so its data is sufficient;
   the rest are unverified.
6. **Whether `CliOutputSegment` crosses a persisted or versioned boundary** — if
   it is written to disk, to SQLite, or to the CLI's JSON-RPC notification
   surface, removal has a migration dimension this task has not scoped.

The investigation is read-only. It produces findings; it changes no code.

## Proposed sequencing

Offered as reasoning, not as a batch plan — the batch breakdown belongs in
`./tasks.md` and is the team-leader's artifact.

0. **Investigation.** The blocking prerequisite above. Read-only.
1. **Unify the `family` key.** Small, and it is a live correctness bug the
   moment step 2 lands. Must precede step 2.
2. **Un-suppress Codex and Copilot as model lanes; label the two variants.**
   No backend change — `spawnArgsFor` already has both arms. Needs a naming
   decision the user surfaces can carry: "agent" (vendor's own harness) vs
   "model" (vendor's weights in Ptah's harness).
3. **Make `onStreamEvent` required; retire the string and segment channels**,
   subject entirely to what step 0 found. This is the maintainability and the
   performance win in one change.
4. **Collapse to a single `Participant` descriptor** — one identity scheme, one
   `listModels()`, one `spawnArgs()`, one availability rule, and `execution:
'harness' | 'model'` as the one honest expression of the distinction. After
   step 3, so there is a single output contract to build on.
5. **AG-UI egress — optional, deferred, not committed.** See below.

Steps 1–4 need no new dependency, no protocol commitment and no vendor
cooperation.

## Why step 2 is a product win and not only a cleanup

With both variants selectable, the tribunal can ask a question it structurally
cannot ask today: **is the difference the model or the harness?** Running
Codex-as-model against Codex-as-agent on the same objective isolates the vendor
harness as a variable. For council and race, the model variant is arguably the
cleaner experiment — same harness, same tools, same prompt, only the weights
change, so disagreement is attributable. For forge, the agent variant is the
entire point.

Secondary benefits of a model lane: tier-3 rendering with no adapter work, no
binary required on the machine, no `resolveCliPath` / `withAsarUnpackedTwin`, no
native spawn, no 30-second startup timeout guard, no process supervision, no
tree-kill. For a four-lane council that is four cold starts and four child
processes replaced by four requests to an already-running pooled proxy.

## AG-UI — recorded verdict, deliberately out of scope

Three separate questions, three answers:

- **As an internal event type — no, and it would be a downgrade.**
  `FlatStreamEventUnion` carries `parentToolUseId`, `agentType`,
  `workflowRunId`, compaction and background-agent events. AG-UI carries none of
  those. Trading a type we control that fits the domain for one we do not
  control that does not fit is a bad trade. This option is closed on purpose.
- **As a performance play — no.** It is a serialization format. The CLI passes
  `FlatStreamEventUnion` by reference in-process; AG-UI adds a hop.
- **As a capability play — one genuine thing.** Because `ptah_agent_spawn` is an
  MCP tool and the tribunal is a framing prompt plus lane descriptors rather
  than a bespoke engine, a participant that is neither a local binary nor a
  model endpoint is a lane family currently unreachable: a remote hosted agent.
  A teammate's agent joining a council, a company's domain agent as a permanent
  seat, one Ptah instance as a lane in another's tribunal.

  **The caveat that decides it:** that capability needs no AG-UI.
  `apps/ptah-cli/docs/jsonrpc-schema.md` already specifies capability
  negotiation, run lifecycle, tool lifecycle and bidirectional HITL via
  `permission.request`. AG-UI buys interop with other people's frontends and
  agents — a distribution bet, not a capability or efficiency one.

If that bet is ever placed, place it cheaply: **egress only**, as a leaf lib
plus a `ptah agui serve` command cloning the `proxy.ts` bootstrap
(`IHttpServerProvider` + minted token + drain, all of which already exist for
the Anthropic proxy). Do not ingest, and do not couple the participant model to
a moving spec. If third parties point their frontends at it, that is a signal.
If not, one leaf lib is deleted.

Not part of this task. Recorded so the question is not re-opened from scratch.
