# Implementation Plan — TASK_2026_237

**Title**: Wire Relay and Crucible into the Tribunal panel, with first-class phase/round state
**Input contract**: `task-description.md` (approved). §2 scope is settled and not re-litigated here.
**Behavioural authority**: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/tribunal/references/relay.md` and `references/crucible.md`. The panel matches them; never the reverse.

---

## 0. Codebase investigation summary

Everything below is verified against source, with `file:line` citations. Nothing is assumed.

### 0.1 What the panel is today

| Fact                                                              | Evidence                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `TribunalMove = 'council' \| 'forge' \| 'race'`                   | `types/tribunal-ui.types.ts:4`                                             |
| `VendorLane` has no role/phase/round field                        | `types/tribunal-ui.types.ts:6-15`                                          |
| Three exhaustive maps keyed by move                               | `tribunal-run.service.ts:8`, `:14`; `step-panel-preview.component.ts:35`   |
| `prepare(move, lanes)` fans one identical objective to every lane | `tribunal-run.service.ts:41-73`                                            |
| Lane↔agent binding is the `[tribunal:<laneId>]` tag regex         | `tribunal-state.service.ts:440-443`                                        |
| Tile status vocabulary is `idle\|running\|completed\|failed`      | `tribunal-page.component.ts:250-263`, `tribunal-tile-host.component.ts:11` |
| One 3-column slotter, also used by late-panelist reconciliation   | `tribunal-state.service.ts:445-453`, used at `:345`                        |
| `TribunalSlice` is the per-workspace state unit                   | `tribunal-state.service.ts:41-47`                                          |
| Wizard is 3 fixed steps with one `_lanes` signal                  | `tribunal-wizard.component.ts:130-138`                                     |
| Discovery already goes through `ClaudeRpcService`                 | `tribunal-discovery.service.ts:100`, `:126`, `:141`                        |

### 0.2 The decisive finding for Q1 — the `tasks:` namespace already does most of this

| Capability                                                | Status                                                                                                             | Evidence                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks:` runtime guard prefix                             | **Already present**                                                                                                | `libs/backend/vscode-core/src/messaging/rpc-handler.ts:85`                                                                                                                   |
| `tasks:` available on VS Code, Electron and CLI           | **Yes — `requires: []`**                                                                                           | `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:249-253`                                                                                                         |
| `tasks:get` returns the folder's filenames                | **Yes — `TaskSpecDetail.artifacts: string[]`**                                                                     | `libs/shared/src/lib/types/task-spec.types.ts:186-191`                                                                                                                       |
| `tasks:getArtifact` reads a document's markdown           | **Yes, but only for a `DocFile`** (closed set)                                                                     | `rpc-tasks.types.ts:75-90`; handler `tasks-rpc.handlers.ts:668-690`                                                                                                          |
| Relay's four deliverables are all `DocFile`s              | **Yes** — `task-description.md`, `implementation-plan.md`, `tasks.md`, `code-logic-review.md`                      | `libs/shared/src/lib/types/task-spec.contract.ts:70-88`                                                                                                                      |
| A real `.ptah/specs/**` watcher exists                    | **Yes** — emits `tasks:changed` (`watcher\|write\|reindex`)                                                        | `libs/backend/task-specs/src/lib/task-index.service.ts:377-390`, `:433`                                                                                                      |
| `tasks:create` allocates a folder + carrier               | **Yes**, with a race-safe id allocator (`ID_ALLOCATION_EXHAUSTED` is an explicit retryable code)                   | `rpc-tasks.types.ts:149-197`                                                                                                                                                 |
| `file:read` as a generic escape hatch                     | **DISQUALIFIED** — requires the `fileSystemAccess` capability, which **only Electron sets**                        | `manifest.ts:318-320`; `apps/ptah-electron/src/rpc-host-profile.ts:35`; the VS Code profile (`apps/ptah-extension-vscode/src/rpc-host-profile.ts:25-30`) does **not** set it |
| Per-task filename literals in production TS are ratcheted | **Yes** — Duty 1 of the contract guard; only `task-spec.contract.ts` and four allowlisted files may hand-write one | `libs/backend/task-specs/src/lib/contract.guard.spec.ts:154-186`, `:201-225`                                                                                                 |
| The asset-name ratchet (Duty 2) scans the tribunal skill  | **No** — it scans only the agent templates and the **orchestration** skill dir                                     | `contract.guard.spec.ts:230-241`, `:262-286`                                                                                                                                 |
| `plugins:list-skills` exists for skill detection          | **Yes**, `requires: []`                                                                                            | `rpc.types.ts:937-940`; `manifest.ts:195-199`                                                                                                                                |

The single remaining gap: **`round-N-judge.md` content is not readable by anything today.** It is not a `DocFile` (and cannot be — `N` is a parameter), and `file:read` is Electron-only.

### 0.3 Other verified facts used below

- `MarkdownBlockComponent` (`libs/frontend/markdown/src/lib/markdown-block.component.ts:29`) takes `content: string` + `variant`. `provideMarkdownRendering()` is already installed app-wide (`apps/ptah-extension-webview/src/app/app.config.ts:72`), and that one app config serves **both** the VS Code webview and the Electron renderer (`apps/ptah-electron/project.json:7` — `implicitDependencies: ["ptah-extension-webview"]`).
- `MonitoredAgent` (`libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:66-124`) exposes `status`, `task`, `displayName`, `model`, `cli`, `cliSessionId` — and no structured progress channel of any kind, confirming §9 Q1's premise.
- `vendor-panel.md` §0 (`references/vendor-panel.md:11-30`) is the existing, precedented mechanism for "the UI decided this; honour it verbatim and skip your own algorithm."
- `.github/skills/tribunal/references/` holds five files; `crucible.md` is missing. `content-manifest.json:86-91` enumerates the same five — confirming §8 Finding 1 on disk.

---

## 1. Decisions

### Q1 — Phase/round/verdict data source

**DECISION: Option C (spec-folder artifacts) is the sole authoritative source, joined with the lane↔agent binding that already exists, refreshed off `AgentMonitorStore`. Cost: exactly ONE new method on the EXISTING `tasks:` namespace.**

Three sub-decisions make this cheaper than §9 sketched it:

**(a) Option A's mechanism is not needed at all — only its signal, which is already free.**
§9 proposed extending the lane tag to `[tribunal:<laneId>:<phase>]` to learn which lane is live. That is unnecessary: the panel **assigns** the roles itself in the wizard, so it already knows lane→role. `laneBindings` (`tribunal-state.service.ts:155-177`) already resolves lane→`MonitoredAgent` via the existing tag, and `MonitoredAgent.status` already says which is running. Role → lane → agent → status is a pure join over data the panel owns. **The `[tribunal:<laneId>]` tag grammar does not change**, so `laneTagOf` (`:440-443`) is untouched and AC-6.2 is satisfied by inspection rather than by a migration.

**(b) Relay needs zero new RPC.** All four deliverables are `DocFile`s. Phase completion = the filename appears in `TaskSpecDetail.artifacts` from `tasks:get`. Opening a deliverable (AC-4.4) = the existing `tasks:getArtifact`.

**(c) Crucible needs one new method, and the round number is free.** `artifacts` already contains `round-1-judge.md`, `round-2-judge.md`, so the round counter (AC-5.1) needs no new call. Only the judge report's _content_ — verdict, defects, mentor note (AC-5.2 … AC-5.4) — is unreachable.

**The one new method**:

```ts
'tasks:getRoundJudge': { params: TasksGetRoundJudgeParams; result: TasksGetRoundJudgeResult }

interface TasksGetRoundJudgeParams extends TasksWorkspaceScopedParams {
  taskId: string;
  /** 1-based. Zod-bounded to an integer in 1..4. */
  round: number;
}
interface TasksGetRoundJudgeResult {
  /** Echoed so a late response cannot render under the wrong round. */
  round: number;
  /** `null` when the round has not been judged yet — a success, not a fault. */
  content: string | null;
}
```

The caller supplies an **integer, never a filename**. The server derives `round-${round}-judge.md`. That preserves precisely the property the `DocFile` restriction was written to protect — "keeps this method a document reader rather than an arbitrary-file read primitive pointed at the user's disk" (`rpc-tasks.types.ts:70-74`) — and makes path traversal structurally impossible.

**RPC registration (NFR-3), both sites named:**

1. **Compile-time**: `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts` (the two interfaces) + `libs/shared/src/lib/types/rpc.types.ts` (re-export at ~`:505-512`, registry entry at ~`:1868`, and the `true` entry in the `RpcMethodRegistry` bool map at ~`:3095` that backs `RPC_METHOD_NAMES` at `:3133`).
2. **Runtime**: **NO CHANGE REQUIRED.** This reuses the existing `tasks:` prefix, already present at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:85`. Confirmed by inspection, as NFR-3 requires the plan to state explicitly.
3. Additionally required by this repo's own invariants (not by NFR-3): add the method to `TasksRpcHandlers.METHODS` (`tasks-rpc.handlers.ts:261-278`) — `RPC_HANDLER_MANIFEST` partitions `RPC_METHOD_NAMES` **exactly**, asserted by `rpc-allowlist.spec.ts`, so a method added to the union without a manifest owner fails that spec.

**Filename literals**: `round-${round}-judge.md` and `rubric.md` are per-task filenames, so Duty 1 of the contract guard (`contract.guard.spec.ts:154-186`) forbids hand-writing them in production TypeScript outside the allowlist. Put them in the one legal place — `libs/shared/src/lib/types/task-spec.contract.ts`, beside the existing `CARRIER_FILE` / `BATCHES_FILE` / `CONTEXT_FILE` constants:

```ts
/** Crucible's frozen grading rubric (see the tribunal skill's crucible.md). */
export const RUBRIC_FILE = 'rubric.md';
/** Crucible's per-round judge report. `round` is 1-based. */
export function roundJudgeFile(round: number): string {
  return `round-${round}-judge.md`;
}
```

**Do NOT add either to `DOC_FILES`.** Two reasons: `DOC_FILES` drives `renderSpecsReadme()` (`task-spec.contract.ts:385`), whose output is hash-compared and rewritten into `.ptah/specs/README.md` in **every user workspace** on activation — a blast radius this feature has no business causing; and the codebase already recognises graded-critique artifacts as "a SUBSET that `DOC_FILES` does not model as a subset" (`contract.guard.spec.ts:175`, the `skill-synthesis/spec-extractor.ts` precedent). These two are exactly that.

**Refresh trigger — no `tasks:changed` subscription, and no app-config change.**
Progress is recomputed from an Angular `effect` over `AgentMonitorStore.agents()`, the same signal `TribunalStateService` already watches at `:148-152`. Every artifact this design reads is written **by a spawned lane**, and a lane writes its file and then exits — so agent-status transitions strictly follow the writes that matter. Subscribing to `tasks:changed` instead would require registering the progress service in `MESSAGE_HANDLERS` (`apps/ptah-extension-webview/src/app/app.config.ts:176`), which is **eager at webview bootstrap** and would therefore drag `TribunalPageComponent` + gridstack into the initial bundle — the exact regression `libs/frontend/tasks-ui/src/services.ts` was created to avoid (TASK_2026_187). Rejected on that cost alone. A manual **Refresh progress** button in the run view is the escape hatch; see Risk R1 for the honest limitation.

**Runner-up rejected — Option B (a `tribunal:progress` MCP tool + RPC namespace).** It is the largest surface (new namespace = both registration sites + a manifest entry + a capability + a new MCP tool + backend work in an otherwise frontend task), and its reliability rests on prompt compliance at _every_ state transition. Option C's reliability rests on files the skill **already mandates the conductor to write in an exact format** (`crucible.md:79-96`, `relay.md:45-50`), so it adds **zero** new conductor obligation. Option C also gets FR-5's defect list and mentor note for free from a contract that already exists; B would have to re-specify all of it. Cost comparison as measured, not guessed: B = one new namespace + tool + handler + manifest + capability; C = one method on a namespace that is already registered, already guarded, and already served by every host.

**Option D (stream parsing) is excluded outright**, including as enrichment. Two sources for one fact, one of them contractless, is how the panel ends up disagreeing with itself.

**AC-4.5 / AC-5.2 compliance**: the progress model has an explicit `{ kind: 'unavailable', reason }` arm reached when no spec folder was allocated or the RPC errors, and the verdict enum carries `'unparsed'` alongside `'pass' | 'revise' | 'reject'`. There is no default arm and no `??` that can produce a PASS. See §2.3.

---

### Q2 — `FULL_AUTO_DIRECTIVE` vs the mandatory gates

**DECISION: (a), refined — autonomy becomes a per-move property, exhaustively mapped. Council/Forge/Race keep the current string byte-identical; Relay and Crucible get a gated directive that names the skill's mandatory checkpoints.**

Exactly what changes in `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts`:

1. **Delete** the module-level constant at `:22-23`:
   ```ts
   const FULL_AUTO_DIRECTIVE = 'Do NOT call AskUserQuestion. Run fully autonomously and make reasonable assumptions; state assumptions inline rather than asking.';
   ```
2. **Add** an exhaustive `Record<TribunalMove, readonly string[]>` in its place — `MOVE_AUTONOMY`. The `council` / `forge` / `race` entries are a single-element array holding **that exact string, unchanged**, so AC-1.4's pinned council framing stays byte-identical. Relay and Crucible carry:
   - **Relay** (`relay.md:140-143`): "Do NOT call `AskUserQuestion` for ordinary implementation decisions — state assumptions inline. You DO own every user gate, because CLI lanes cannot ask: after `task-description.md` and again after `implementation-plan.md`, present the document path and a short summary as a plain message and wait for `APPROVED` before relaying the next phase. If a lane returns a `## Clarifications Needed` block instead of its deliverable, surface those questions to the user, then re-spawn that lane with a `## User Decisions` section."
   - **Crucible** (`crucible.md:153`): "Do NOT call `AskUserQuestion` for ordinary decisions. The round cap below is hard: stop at it and present the open defects honestly. A 3rd revise round runs **only if the user explicitly asks for it** — never on your own initiative, and never a 4th."
3. **Line `:124`** currently hardcodes `"You are the Tribunal conductor running FULLY AUTONOMOUSLY."` — the same contradiction in a second place. It becomes a per-move clause off the same map: the flat moves keep `running FULLY AUTONOMOUSLY` verbatim; Relay/Crucible get `You are the Tribunal conductor. You own every user gate.`
4. **Line `:133`** (`- ${FULL_AUTO_DIRECTIVE}` under `Rules:`) emits `MOVE_AUTONOMY[move]` as one bullet per entry.

**Runner-up rejected — (b), the panel renders the checkpoint as a UI approval.** It requires the panel to (i) detect a checkpoint and (ii) inject an approval into an in-flight conductor turn. The panel has no such write channel by design: `prepare()`'s own contract (`tribunal-run.service.ts:32-40`) is that it deliberately does _not_ start or drive the session — "the robust normal-chat machinery owns the streaming, turn-end, and spawn lifecycle." Building a second injection path duplicates the conductor chat pane that is already on screen at 30% width (`tribunal-page.component.ts:70-75`), for no gain.

**Also rejected — (c), a wizard toggle.** A toggle whose "off" position contradicts the skill's mandatory gates ships a footgun that writes unreviewed code onto the user's active branch (both moves change files — `relay.md:7`, `crucible.md:7`). Autonomy here is a property of the move, not a user preference.

---

### Q3 — Who allocates `.ptah/specs/TASK_[ID]`

**DECISION: the panel allocates it via the existing `tasks:create` RPC immediately before launch, for Relay and Crucible only, and states it in the framing as an override.**

- Q1-C needs the folder id, and after-the-fact discovery is a race, not a lookup: agents create task folders constantly in this very repo, so "the newest folder since launch" is a guess that will be wrong.
- `tasks:create` is host-agnostic (`requires: []`), and its backend id-allocator already implements the CLAUDE.md folder-scan rule _and_ the exclusive-create race, surfacing `ID_ALLOCATION_EXHAUSTED` as an explicitly retryable code (`rpc-tasks.types.ts:186-196`). Re-implementing allocation in the frontend would be strictly worse.
- It writes the `task.md` carrier, so the run appears on the Tasks board the moment it launches — a real user-visible win, not a side effect.
- **Failure is non-blocking and honest**: if `tasks:create` fails or the user is in a workspace with no `.ptah/`, the run launches anyway with `specTaskId = null`, the framing omits the spec-folder line (the conductor then allocates per the skill), and the run view shows the AC-4.5 `progress unavailable` state with the reason. **Progress tracking is an enhancement; it is never a launch blocker.**

Call shape: `tasks:create` with `{ title: 'Tribunal <move>: <first 60 chars of nothing yet>' }` — the objective is not known at prepare time (the user types it into the conductor chat afterwards), so the title is `Tribunal Relay` / `Tribunal Crucible` plus the ISO date, `type: 'FEATURE'`, `status: 'in_progress'`, and a `description` `>-` block naming the lanes and roles.

**The framing must override the skill's own allocation step**, because `relay.md:40` and `crucible.md:117` instruct the conductor to scan and allocate. The precedent for this already exists and must be reused rather than invented: `vendor-panel.md` §0 is exactly the "the UI decided; skip your own algorithm" mechanism. The new framing line is:

```
Spec folder: TASK_YYYY_NNN (already created by the Tribunal UI). Use it. Do NOT scan for or allocate a new task id.
```

**Runner-up rejected — the conductor allocates, the panel discovers afterwards.** Keeps the skill authoritative but leaves the panel guessing which folder is this run's, which is precisely the failure §9 Q3 names. It also forces a polling `tasks:list` diff whose answer is a heuristic.

---

### Q4 — Does the panel embed the protocol, or depend on the skill?

**DECISION: (b) — depend on the skill, plus a minimal _invariant kernel_ of only what the panel itself owns, plus a non-blocking installed-skill advisory.**

Embedding `crucible.md`'s protocol (defect contract, regression stop, judge-never-edits, rubric freeze, the gate table) into the framing makes the panel a second copy of the skill. §11 says the skill is the authority; two copies drift, and drift _here_ means the panel and the skill disagree about the judge output contract that FR-5's parser gates on. That is the exact failure AC-2.8 exists to prevent, at roughly ten times the surface area.

So the framing carries a pointer — `Read the tribunal skill's references/crucible.md (or relay.md) before spawning anything` — plus only the facts the panel **asserts and therefore owns**:

1. the explicit role-tagged lane lines (FR-2 / AC-2.7);
2. the spec folder id (Q3);
3. the round cap and the rubric text **verbatim** (FR-3 — these are user input, not protocol);
4. the one protocol fact the panel's own parser is coupled to: that the judge writes `round-N-judge.md` into the spec folder under the `## VERDICT` / `## SCORES` / `## DEFECTS` / `## MENTOR NOTE` headings, and that every defect must carry `file:line`. Stating this is stating the panel's dependency, not restating the skill.

Everything else stays in the skill.

**Installed-skill advisory**: `plugins:list-skills` with `{ pluginIds: ['ptah-core'] }` (`rpc.types.ts:937-940`, `requires: []`) tells us whether the tribunal skill is present. Three outcomes, and only one of them shows anything:

| Detection               | UI                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| skill present           | nothing                                                                                              |
| skill definitely absent | Relay/Crucible cards carry a warning badge "Needs the tribunal skill" + a link, and stay **enabled** |
| detection failed        | nothing (an unreliable check must not produce a scary banner)                                        |

The cards stay `enabled: true` in every case — AC-1.2 forbids a gating badge, and given §8 Finding 1 the skill is currently absent for **everyone**, so blocking on it would ship a dead feature.

---

### Q5 — Layout for the non-flat moves

**DECISION: one tile substrate, unchanged. `slotFor()`'s 3-column grid stays exactly as it is. Sequence and role are expressed in a dedicated per-move strip rendered above the tile grid, plus a role badge in each tile header.**

- **Relay** → `RelayPhaseRailComponent`, a horizontal four-step rail (plan → architect → implement → review) in the panelist bar region (`tribunal-page.component.ts:78-105`). Tiles keep 3-column slotting, ordered by role.
- **Crucible** → `CrucibleVerdictPanelComponent` in the same region. Two lanes already land side by side under the existing slotter (x=0, x=4).

Why not per-move slotters (the rejected runner-up: a 4×1 pipeline row for Relay, a 2×1 pair for Crucible):

1. **`slotFor` is also the late-panelist path.** `reconcileSlice` assigns `this.slotFor(vendorCount)` at `tribunal-state.service.ts:345` for agents the conductor spawns mid-run beyond the chosen roster. A "4-slot pipeline layout" has no defined answer for the 5th tile, and making `slotFor` move-and-role-dependent forces the reconciliation path to learn about roles it cannot know.
2. **A 4-wide row at 12 columns gives each tile `w: 3`**, narrower than the current `w: 4`, which makes streaming agent output unreadable in the exact move where reading it matters most.
3. Keeping one slotter leaves gridstack drag/resize persistence (`updateTilePosition`, `:228-235`) and AC-6.3's cap untouched, and gives AC-4.2's "structurally unable to show two running phases" a **single owner** (the rail's data model, §2.3) instead of spreading it across a layout function.

---

## 2. Target architecture

### 2.1 Type changes — role goes **on** `VendorLane`, not in a wrapper

`libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts`:

```ts
export type TribunalMove = 'council' | 'forge' | 'race' | 'relay' | 'crucible';

/** relay.md:45-50 — exactly the four phases, in pipeline order. */
export const RELAY_ROLES = ['plan', 'architect', 'implement', 'review'] as const;
export type RelayRole = (typeof RELAY_ROLES)[number];

/** crucible.md:28-35 — exactly the unequal pair. */
export const CRUCIBLE_ROLES = ['executor', 'judge'] as const;
export type CrucibleRole = (typeof CRUCIBLE_ROLES)[number];

export type LaneRole = RelayRole | CrucibleRole;

export interface VendorLane {
  laneId: string;
  family: string;
  displayName: string;
  cli: CliType;
  model?: string;
  agentId?: string;
  providerId?: string;
  ptahCliId?: string;
  /** Named role. Present for relay/crucible lanes; absent for the flat moves. */
  role?: LaneRole;
}

/** Exhaustive; no `default:` arm. Widening TribunalMove breaks this on purpose. */
export function rolesForMove(move: TribunalMove): readonly LaneRole[] {
  switch (move) {
    case 'relay':
      return RELAY_ROLES;
    case 'crucible':
      return CRUCIBLE_ROLES;
    case 'council':
    case 'forge':
    case 'race':
      return [];
  }
}
```

**Why an optional field and not a `RoledLane` wrapper.** `VendorLane` is threaded through `buildTilesForRun`, `setLanes`, `laneBindings`, `matchLaneToAgent`, `laneFromAgent`, `spawnArgsFor`, `TribunalDiscoveryService` and the slice itself. A wrapper forks every one of those into two shapes or forces unwrapping at each. Decisively: `laneFromAgent` (`tribunal-state.service.ts:355-365`) synthesizes lanes for **late** panelists that have no role by definition — an optional field expresses that natively; a wrapper would need a null role anyway, which is the optional field with extra indirection.

The optionality is not a hole, because it is closed at the two places that matter: `validateRoster` blocks launch on any unfilled slot (§2.2), and the framing builder asserts a role is present for role moves before it emits a lane line.

### 2.2 `TribunalSlice` after phase/round/verdict state lands

```ts
interface TribunalSlice {
  readonly tiles: readonly TribunalTile[];
  readonly move: TribunalMove;
  readonly lanes: readonly VendorLane[];
  readonly surfaceId: SurfaceId | null;
  readonly correlationId: string | null;

  /** Q3 — allocated by tasks:create at prepare time. `null` = no progress source. */
  readonly specTaskId: string | null;
  /** Crucible only. 1..2 at launch (AC-3.2). `null` for other moves. */
  readonly roundCap: number | null;
  /** Crucible only. The user's rubric text, forwarded verbatim to the framing. */
  readonly rubric: string | null;
  /** Derived, recomputed on every agent tick. Never null; see the union below. */
  readonly progress: TribunalProgress;
}
```

Every new field is inside the existing slice, so the per-workspace map, the bootstrap-sentinel migration (`:372-390`) and removed-workspace cleanup (`:133-139`) are unchanged (AC-6.1). `EMPTY_SLICE` (`:49-55`) gains the four defaults (`null`, `null`, `null`, `{ kind: 'none' }`), which is what makes `reset()` — and therefore `Close Tribunal` (`tribunal-page.component.ts:203`) — clear the new state with no extra code (AC-6.4).

### 2.3 The progress model — AC-4.2 and AC-5.2 enforced by the _type_

```ts
export type RelayPhaseStatus = 'pending' | 'complete' | 'failed';

export interface RelayPhase {
  readonly role: RelayRole;
  readonly deliverable: string; // from the shared contract, not a literal here
  readonly laneId: string | null;
  readonly status: RelayPhaseStatus; // NOTE: no 'running'
  /** Set when the live lane differs from the originally assigned one (AC-4.4). */
  readonly reassignedFromLaneId?: string;
}

export type CrucibleVerdict = 'pass' | 'revise' | 'reject' | 'unparsed';

export interface CrucibleDefect {
  readonly id: string; // "D1"
  readonly severity: 'blocking' | 'major' | 'minor';
  readonly location: string; // file:line — REQUIRED
  readonly what: string;
  readonly expected: string;
}

export interface CrucibleRound {
  readonly round: number;
  readonly verdict: CrucibleVerdict;
  readonly defects: readonly CrucibleDefect[];
  readonly mentorNote: string | null;
}

export type CrucibleTermination = 'in-progress' | 'pass' | 'cap-reached-with-defects' | 'reject' | 'regression-stop';

export type TribunalProgress =
  | { readonly kind: 'none' } // council/forge/race
  | { readonly kind: 'unavailable'; readonly reason: string } // AC-4.5
  | {
      readonly kind: 'relay';
      readonly phases: readonly RelayPhase[];
      /** At most ONE. `null` = nothing running. AC-4.2 by construction. */
      readonly runningIndex: number | null;
    }
  | { readonly kind: 'crucible'; readonly roundCap: number; readonly currentRound: number; readonly rounds: readonly CrucibleRound[]; readonly termination: CrucibleTermination };
```

`RelayPhase.status` deliberately **has no `'running'` member**. "Which phase is live" is a single nullable index on the container. Two concurrent `running` phases is therefore not a state the UI can be asked to render — which is exactly what AC-4.2 demands, expressed in the type rather than defended by a guard someone can forget.

`CrucibleVerdict` has no `'pass'` default anywhere: an absent file yields no `CrucibleRound` at all; a present-but-unreadable file yields `'unparsed'`, which the UI renders as "awaiting verdict" (AC-5.2).

### 2.4 How the wizard branches without forking

**One `TribunalWizardComponent`, one `_lanes` signal, one run path. Two lane _editors_.**

`steps` becomes a `computed` off the move:

| Move                   | Steps                               |
| ---------------------- | ----------------------------------- |
| council / forge / race | `Move → Panel → Run` (3, unchanged) |
| relay                  | `Move → Roster → Run` (3)           |
| crucible               | `Move → Roster → Rubric → Run` (4)  |

The lane step `@switch`es on a `computed` `laneStepKind()`:

- `'flat'` → the existing `<ptah-step-panel-preview>`, **behaviourally untouched** (AC-2.6)
- `'roles'` → the new `<ptah-step-role-roster>`

`StepRoleRosterComponent` emits `readonly VendorLane[]` — **the same output contract as the flat picker** — so `_lanes` stays a single signal, `StepRunComponent` needs no shape branch, and `TribunalRunService.prepare()` takes one lane list regardless of move. That is the answer to "without forking into two parallel wizards": the fork is one `@switch` over the editor, not two wizards.

Role-slot rendering: `rolesForMove(move)` drives N slots; each slot is a vendor `<select>` + a model `<select>` fed by `TribunalDiscoveryService`. `laneId` for slot _i_ is `makeLaneId(baseKey, i)` — the existing helper, so two slots on the same family get distinct lane ids and **are never collapsed** (AC-2.2).

Validation is a pure function in a new `services/tribunal-roster-rules.ts`, unit-testable with no TestBed:

```ts
export interface RosterIssue {
  readonly severity: 'block' | 'warn';
  readonly message: string;
}
export function validateRoster(move: TribunalMove, lanes: readonly VendorLane[]): readonly RosterIssue[];
```

| Move     | Rule                                                                         | Severity                | Source                           |
| -------- | ---------------------------------------------------------------------------- | ----------------------- | -------------------------------- |
| relay    | all four roles filled                                                        | **block**               | AC-2.2                           |
| relay    | `implement` lane identical to `review` lane (same family **and** same model) | **block**               | `relay.md:84`                    |
| relay    | `implement` and `review` same family, different model                        | warn                    | `relay.md:85`                    |
| crucible | both roles filled                                                            | **block**               | AC-2.3                           |
| crucible | `judge.family === executor.family`                                           | **block**               | `crucible.md:37`, `:53`          |
| crucible | fewer than 2 available families in discovery → the move **card** is disabled | **block at card level** | `crucible.md:55` + settings link |

**Sub-decision inside AC-2.5**: same-family judge **blocks with no override**. AC-2.5 left "if permitted at all" open; the answer is _not permitted from the panel_. The loop's entire validity is independence (`crucible.md:182`), and the skill's escape hatch (`crucible.md:53`) is written for a conversational pin where the Conductor annotates the weakness in its final summary — an annotation the panel cannot make. Blocking with a clear reason is cheaper and more honest than a second confirmation surface.

### 2.5 Cost estimator — changes shape, per AC-3.3

`TURNS_PER_VENDOR` (`step-panel-preview.component.ts:35`) is **deleted**, not extended, and replaced by a pure exhaustive function in a new `services/tribunal-estimate.ts`:

```ts
export function estimateTurns(move: TribunalMove, laneCount: number, roundCap: number): number {
  switch (move) {
    case 'council':
      return laneCount * 2 + 1;
    case 'forge':
      return laneCount * 3 + 1;
    case 'race':
      return laneCount * 3 + 1;
    case 'relay':
      return RELAY_ROLES.length + 1; // per PHASE, not per lane — relay.md:116
    case 'crucible':
      return 2 * (1 + roundCap) + 1; // 2 paid calls per round — crucible.md:74, :117
  }
}
```

The trailing `+ 1` is the conductor's own turn, preserving the existing convention (`:322`). The flat-move arms reproduce the current numbers exactly, so AC-1.4's byte-identical guarantee extends to the displayed estimate.

Deleting `TURNS_PER_VENDOR` **satisfies** AC-1.1 rather than dodging it: exhaustiveness is preserved (a `switch` with no `default:`), no `??` escape hatch is introduced, and AC-3.3 explicitly says this formula "changes shape rather than gaining two map entries." The team-leader should not read the deletion as a skipped acceptance criterion.

### 2.6 Framing — the wire contract with the skill (AC-2.7, AC-2.8)

The `[tribunal:<laneId>]` tag grammar is **unchanged**. The role is an additive parenthesised token in the human-readable remainder:

```
  [tribunal:codex#0] (plan) Codex — ptah_agent_spawn({ cli: "codex", model: "gpt-5-codex" }). Phase: plan. Deliverable: <specFolder>/task-description.md
```

Full framing skeleton for a role move (flat moves keep their current shape apart from the autonomy bullet):

```
Convene a Tribunal Relay. You are the Tribunal conductor. You own every user gate.

Relay: one task through a sequential plan → architect → implement → review pipeline, one CLI lane per phase.

Read the tribunal skill's references/relay.md before spawning anything; it is the authority for this move.

Spec folder: TASK_2026_NNN (already created by the Tribunal UI). Use it. Do NOT scan for or allocate a new task id.

This panel is EXPLICITLY defined by the user. ... <existing no-discovery paragraph, unchanged> ...
Each lane's ROLE is stated below and is authoritative — do not infer it from lane order.

  [tribunal:...] (plan) ...
  [tribunal:...] (architect) ...
  [tribunal:...] (implement) ...
  [tribunal:...] (review) ...

Rules:
- <MOVE_AUTONOMY[move] bullets>
- The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task. ... <unchanged> ...

Objective:
```

Crucible adds, before `Rules:`:

```
Round cap: 2 revise rounds. Stop at the cap and report open defects honestly.
Rubric — write this VERBATIM to <specFolder>/rubric.md before the first spawn, then freeze it after round 1:
<rubric text>

Each judge round writes <specFolder>/round-N-judge.md under the ## VERDICT / ## SCORES / ## DEFECTS / ## MENTOR NOTE
headings, with every defect carrying a file:line citation. The Tribunal panel reads those files to show progress.
```

**AC-2.8 mirror**, in the same change, into `references/vendor-panel.md` §0 (`:11-30`):

- the `(<role>)` token form, and that when present the role is authoritative;
- the `Spec folder:` line and "do not allocate a new task id";
- one added sentence in `references/crucible.md` at `:51` pointing at §0: when a role token is present, the first-lane/last-lane heuristic does not apply and no confirmation round-trip is needed. This closes the documented guess (AC-2.7) and is a doc-alignment edit mandated by AC-2.8, **not** a behaviour change to the move (§11 respected).

`prepare()`'s signature widens from `(move, lanes)` to a single object so the new inputs travel together:

```ts
interface TribunalLaunchSpec {
  readonly move: TribunalMove;
  readonly lanes: readonly VendorLane[];
  readonly rubric?: string;    // crucible
  readonly roundCap?: number;  // crucible
}
async prepare(spec: TribunalLaunchSpec): Promise<boolean>;
```

It becomes `async` because Q3's `tasks:create` is awaited before the tab is created. `StepRunComponent.run()` (`step-run.component.ts:76-85`) becomes `async` accordingly; the existing rollback path (`:93-97`) is unchanged.

---

## 3. File-by-file change list

### 3.1 Inside `libs/frontend/tribunal-panel` (in scope, primary)

| File                                                     | Action          | What and why                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/types/tribunal-ui.types.ts`                     | MODIFY          | Widen `TribunalMove`; add `RELAY_ROLES`/`CRUCIBLE_ROLES`/`LaneRole`/`rolesForMove`; add `role?` to `VendorLane`; add the `TribunalProgress` union (§2.3)                                                                                     |
| `src/lib/services/tribunal-estimate.ts`                  | CREATE          | `estimateTurns()` (§2.5). Pure; testable without TestBed                                                                                                                                                                                     |
| `src/lib/services/tribunal-roster-rules.ts`              | CREATE          | `validateRoster()` (§2.4). Pure                                                                                                                                                                                                              |
| `src/lib/services/judge-report.parser.ts`                | CREATE          | Pure parser for `round-N-judge.md` → `CrucibleRound`. Verdict, defects, mentor note. Drops defects with no `file:line` (AC-5.3)                                                                                                              |
| `src/lib/services/tribunal-progress.service.ts`          | CREATE          | Derives `TribunalProgress` from `tasks:get` + `tasks:getRoundJudge` + `laneBindings`; `effect` over `AgentMonitorStore.agents()`; owns the `unavailable` arm                                                                                 |
| `src/lib/services/tribunal-state.service.ts`             | MODIFY          | Four new slice fields + setters; `EMPTY_SLICE` defaults; `progress` computed exposure. `slotFor`, `reconcileSlice`, `laneTagOf` **untouched**                                                                                                |
| `src/lib/services/tribunal-run.service.ts`               | REWRITE         | `MOVE_PHRASE`/`MOVE_FRAMING` completed to five; `FULL_AUTO_DIRECTIVE` → `MOVE_AUTONOMY` (Q2); `prepare()` → `TribunalLaunchSpec`, async, allocates the spec folder (Q3); role tokens + spec-folder line + rubric block in the framing (§2.6) |
| `src/lib/services/tribunal-discovery.service.ts`         | MODIFY          | Add a shared `vendors` signal + memoized `ensureDiscovered()` so the move step and the lane step share one `agent:getConfig` round trip. `discover()` kept as-is                                                                             |
| `src/lib/wizard/step-pick-move.component.ts`             | MODIFY          | Five cards, distinct icons, `enabled: true` (AC-1.2); Crucible disabled with `crucible.md:55`'s reason when < 2 families; skill advisory badge (Q4); `iconFor` becomes an exhaustive switch                                                  |
| `src/lib/wizard/step-role-roster.component.ts`           | CREATE          | N role slots from `rolesForMove()`; per-slot vendor + model select; renders `validateRoster` issues; emits `VendorLane[]`                                                                                                                    |
| `src/lib/wizard/step-crucible-rubric.component.ts`       | CREATE          | Rubric textarea prefilled with `crucible.md:61-71`'s table; states the binary-pass-condition + how-to-check shape; 3-7 criteria warn, empty blocks; round-cap control defaulting to 2, max 2 (AC-3.2)                                        |
| `src/lib/wizard/step-panel-preview.component.ts`         | MODIFY          | Delete `TURNS_PER_VENDOR`; call `estimateTurns()`; consume the shared discovery cache. Flat-move behaviour otherwise unchanged (AC-2.6)                                                                                                      |
| `src/lib/wizard/tribunal-wizard.component.ts`            | MODIFY          | `steps` becomes computed per move; `@switch` between the two lane editors; carries `rubric`/`roundCap` signals; `canAdvance` consults `validateRoster`                                                                                       |
| `src/lib/wizard/step-run.component.ts`                   | MODIFY          | `async run()`; passes `TribunalLaunchSpec`; shows the exact per-move estimate; surfaces a spec-folder-allocation failure as a non-blocking notice                                                                                            |
| `src/lib/components/relay-phase-rail.component.ts`       | CREATE          | Four-step rail; per-step lane name, deliverable filename, status; open-deliverable action; reassignment display (AC-4.1, AC-4.4); "phase progress unavailable" arm (AC-4.5)                                                                  |
| `src/lib/components/crucible-verdict-panel.component.ts` | CREATE          | "Round N of M"; verdict chip (4 visual states incl. `awaiting`); defect list with severity + `file:line`; mentor note via `MarkdownBlockComponent`; terminal-state labels (AC-5.1 … AC-5.6)                                                  |
| `src/lib/tribunal-page.component.ts`                     | MODIFY          | Render the per-move strip above the tile grid; role badge into `tileLabel`; a **Refresh progress** button; `Close Tribunal` unchanged (reset covers the new state)                                                                           |
| `src/lib/tribunal-tile-host.component.ts`                | MODIFY          | Optional `role` input rendered as a header badge. Status vocabulary unchanged                                                                                                                                                                |
| `src/index.ts`                                           | MODIFY          | Export the new progress types (`TribunalProgress`, `LaneRole`, …) consumed by tests and hosts                                                                                                                                                |
| `*.spec.ts` (existing 6) + 7 new spec files              | MODIFY / CREATE | See §5                                                                                                                                                                                                                                       |

### 3.2 OUTSIDE `libs/frontend/tribunal-panel` — flagged

| File                                                               | Action          | Why                                                                                                                                   |
| ------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/shared/src/lib/types/task-spec.contract.ts`                  | MODIFY          | Add `RUBRIC_FILE` + `roundJudgeFile(round)`. **Required** — contract-guard Duty 1 permits per-task filename literals only here        |
| `libs/shared/src/lib/types/rpc/rpc-tasks.types.ts`                 | MODIFY          | `TasksGetRoundJudgeParams` / `Result`                                                                                                 |
| `libs/shared/src/lib/types/rpc.types.ts`                           | MODIFY          | Type re-export (~`:505-512`), registry entry (~`:1868`), `true` in the bool map (~`:3095`)                                            |
| `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.schema.ts`   | MODIFY          | Zod: `taskId` string, `round` int 1..4                                                                                                |
| `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` | MODIFY          | Add to `METHODS` (`:261-278` — manifest partition invariant) + `registerGetRoundJudge()` mirroring `registerGetArtifact` (`:668-690`) |
| `libs/backend/task-specs/src/lib/task-index.service.ts`            | MODIFY          | `readRoundJudge(root, folderName, round)` beside `readArtifact` (`:345-363`), using `roundJudgeFile()`                                |
| `apps/.../skills/tribunal/references/vendor-panel.md`              | MODIFY          | §0 gains the role token + spec-folder line (AC-2.8)                                                                                   |
| `apps/.../skills/tribunal/references/crucible.md`                  | MODIFY          | One-line pointer at `:51` deferring to §0 when a role token is present                                                                |
| `.github/skills/tribunal/**`                                       | CREATE / MODIFY | Re-sync to six references (§10 of the requirements) — its own batch, **before** implementation                                        |
| `content-manifest.json`                                            | MODIFY          | Regenerate via `node scripts/generate-content-manifest.js` (§8 Finding 1)                                                             |

**Explicitly NOT changed** (and why, so nobody "helpfully" adds them):

- `libs/backend/vscode-core/src/messaging/rpc-handler.ts` — `tasks:` is already at `:85`. No runtime-guard edit.
- `DOC_FILES` in `task-spec.contract.ts` — see Q1; widening it rewrites `.ptah/specs/README.md` in every user workspace.
- `apps/ptah-extension-webview/src/app/app.config.ts` — no `MESSAGE_HANDLERS` entry; see Q1's refresh-trigger decision.
- `TRIBUNAL_MAX_VENDOR_TILES`, `slotFor`, `laneTagOf`, `reconcileSlice` — AC-6.2 / AC-6.3 by non-modification.
- `apps/ptah-docs/**` — follow-up per §10.

---

## 4. Sequenced work breakdown

Dependencies are hard unless stated. **File-disjoint** batches can run concurrently.

| Batch  | Contents                                                                                                                                                                                              | Depends on | Disjoint with |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------- |
| **B0** | `.github/skills/tribunal/` re-sync to six references. Copy `crucible.md`; diff the other five against the shipped copies. Doc-only                                                                    | —          | all           |
| **B1** | The RPC method, end to end: contract constants → shared types → Zod → handler → `TaskIndexService.readRoundJudge` + specs                                                                             | —          | B2, B3        |
| **B2** | `tribunal-ui.types.ts`, `tribunal-estimate.ts`, `tribunal-roster-rules.ts`, `judge-report.parser.ts`, `tribunal-state.service.ts` slice fields — **additive only, nothing removed, tree stays green** | —          | B1            |
| **B3** | `tribunal-run.service.ts` + all five wizard components + `tribunal-discovery.service.ts`. The breaking `prepare()` signature change lands **with** its call sites                                     | B2         | B4            |
| **B4** | `tribunal-progress.service.ts` + its spec                                                                                                                                                             | B1, B2     | **B3**        |
| **B5** | `relay-phase-rail`, `crucible-verdict-panel`, `tribunal-page.component.ts`, `tribunal-tile-host.component.ts`, `index.ts`                                                                             | B3, B4     | —             |
| **B6** | `vendor-panel.md` §0 + `crucible.md:51` pointer (AC-2.8) — must land in the same PR as B3's framing change                                                                                            | B3         | B4, B5        |
| **B7** | Release: regenerate `content-manifest.json`, verify `crucible.md` in `plugins.files` and a changed `contentHash`, merge to `main`, clean-profile verification per §8 Step 3                           | all        | —             |

**Batching notes for the team-leader**

- **B2 and B3 must not be split across a "green tree" boundary in the other order.** B2 is deliberately additive so the tree compiles after it; B3 is where `TURNS_PER_VENDOR` dies and `prepare()` changes shape, so it must carry every call site in one commit.
- **B3 ‖ B4 is the parallelism win** — they share no file. B3 is the wizard; B4 is the reader.
- **B1 ‖ B2 is the other one** — backend/shared vs frontend, no overlap.
- **B0 first, always.** Every agent working this task reads `.github/skills/tribunal/`, and today it does not describe Crucible.
- **B7 is a release step, not a code change.** CI wiring for the manifest generator stays a separate DEVOPS task per §8.

Gates: `nx affected -t typecheck` after B1 and after B2; `nx test|lint|typecheck tribunal-panel` after B3, B4, B5.

---

## 5. Test strategy, mapped to FR-7

| AC                  | Test                                                                                                                                                                                                                                                                                                          | Location                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --- |
| AC-1.1              | Compile-time. Widening `TribunalMove` with any exhaustive map incomplete fails `nx typecheck tribunal-panel`. A test asserting `rolesForMove` returns `[]` for the three flat moves pins the switch                                                                                                           | `tribunal-ui.types.spec.ts` (new)                                               |
| AC-1.2              | Five cards rendered; all `enabled`; no "Coming soon" node in the DOM                                                                                                                                                                                                                                          | `step-pick-move.component.spec.ts` (new)                                        |
| AC-1.3              | Framing for relay/crucible contains the move phrase and the shape sentence                                                                                                                                                                                                                                    | `tribunal-run.service.spec.ts` (extend)                                         |
| **AC-1.4 / AC-7.2** | **Snapshot-style equality on the full framing string for all five moves**, from a fixed lane fixture. The council/forge/race snapshots must match the strings the current suite already asserts (`tribunal-run.service.spec.ts:167-260`) character for character                                              | `tribunal-run.service.spec.ts`                                                  |
| AC-2.2              | Two relay slots on the same family, different models → two lanes survive, distinct `laneId`s, no de-duplication                                                                                                                                                                                               | `tribunal-roster-rules.spec.ts` (new)                                           |
| AC-2.4              | implement === review (family + model) → `block`; same family, different model → `warn`, not block                                                                                                                                                                                                             | `tribunal-roster-rules.spec.ts`                                                 |
| AC-2.5              | judge family === executor family → `block`; < 2 available families → the Crucible card is disabled and states the reason                                                                                                                                                                                      | `tribunal-roster-rules.spec.ts`, `step-pick-move.component.spec.ts`             |
| AC-2.6              | Council/forge/race lane selection produces byte-identical `VendorLane[]` to today, `role` absent                                                                                                                                                                                                              | `step-panel-preview.component.spec.ts` (extend)                                 |
| AC-2.7              | Every relay/crucible lane line carries its `(role)` token, in role order                                                                                                                                                                                                                                      | `tribunal-run.service.spec.ts`                                                  |
| AC-3.3              | `estimateTurns` table test across all five moves. Relay is invariant in `laneCount`; crucible is linear in `roundCap`; the three flat arms reproduce today's numbers                                                                                                                                          | `tribunal-estimate.spec.ts` (new)                                               |
| AC-3.5              | Empty rubric blocks launch with a stated reason; 2 or 8 criteria warn but do not block                                                                                                                                                                                                                        | `step-crucible-rubric.component.spec.ts` (new)                                  |
| AC-4.2              | **Structural** — no `'running'` member exists on `RelayPhaseStatus`, plus a derivation test that two simultaneously-running lanes still yield a single `runningIndex`                                                                                                                                         | `tribunal-progress.service.spec.ts` (new)                                       |
| AC-4.5              | `tasks:get` rejecting, or `specTaskId === null` → `{ kind: 'unavailable' }`, and the rail renders "phase progress unavailable"; the vendor tiles still render                                                                                                                                                 | `tribunal-progress.service.spec.ts`, `relay-phase-rail.component.spec.ts` (new) |
| **AC-5.2**          | Verdict parsing table: `PASS` → `pass`; `REVISE` → `revise`; `REJECT` → `reject`; **the literal contract template line `PASS \| REVISE \| REJECT` echoed back → `unparsed`**; empty `## VERDICT` → `unparsed`; missing file → no round at all. **No input produces `pass` unless the word PASS stands alone** | `judge-report.parser.spec.ts` (new)                                             |
| AC-5.3              | Defects without `file:line` are dropped. A Windows path (`D:\a\b.ts:42`) parses to location `D:\a\b.ts:42`, not `D`                                                                                                                                                                                           | `judge-report.parser.spec.ts`                                                   |
| AC-5.5              | `REJECT` → `termination: 'reject'`; the panel renders no "revise" affordance                                                                                                                                                                                                                                  | `crucible-verdict-panel.component.spec.ts` (new)                                |
| AC-5.7              | The mentor note goes through `ptah-markdown-block`; defect strings are interpolated. No `[innerHTML]` binding anywhere in the lib                                                                                                                                                                             | `crucible-verdict-panel.component.spec.ts` + a lint-style grep assertion        |
| AC-6.1              | Slice round-trip across a workspace switch preserves `specTaskId` / `roundCap` / `rubric` / `progress`; the sentinel migration still moves them                                                                                                                                                               | `tribunal-state.service.spec.ts` (extend)                                       |
| AC-6.4              | After `endRun()`, a fresh `prepare()` for a different move sees no residual phase/round/verdict                                                                                                                                                                                                               | `tribunal-run.service.spec.ts`                                                  |
| AC-7.3              | `nx test                                                                                                                                                                                                                                                                                                      | lint                                                                            | typecheck tribunal-panel`green;`nx affected -t typecheck` green after B1 | CI  |
| B1                  | Handler: round out of bounds → Zod rejection; missing file → `content: null` **success**; `readRoundJudge` composes the path via `roundJudgeFile()`                                                                                                                                                           | `tasks-rpc.handlers.spec.ts`, `task-index.service.spec.ts` (extend)             |

---

## 6. Risks this design introduces that the requirements did not anticipate

| #       | Risk                                                                                                                                                                                                                                                                                                                                              | Mitigation                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**  | **Agent-tick refresh misses conductor-authored artifacts.** Progress recomputes on `AgentMonitorStore.agents()`. Every file this design reads is lane-written, so ordering holds — but if a Conductor ever writes a deliverable itself (e.g. it takes a failed phase in-house, `crucible.md:156`), that artifact is invisible until the next tick | Explicit **Refresh progress** button in the run view; the `unavailable`/stale case is labelled, never silently shown as `pending`                                                                                                 |
| **R2**  | **Every Relay/Crucible launch creates a task folder**, including abandoned runs. The Tasks board accumulates tribunal shells                                                                                                                                                                                                                      | Create with `status: 'in_progress'` so they are visible rather than hidden in Backlog; let the existing `tasks:sweepFinished` retention handle them. **Never auto-delete on Close Tribunal** — the artifacts are the run's output |
| **R3**  | **The panel caps at 2 rounds, but the Conductor may legitimately run a 3rd on the user's say-so** (`crucible.md:153`). A UI that clamps at 2 would lie about a run that is genuinely in progress                                                                                                                                                  | Zod bounds `round` at 1..4, not 1..2. The panel renders "Round 3 of 2 (user-authorised)" rather than clamping, and a 4th round surfaces as a visible anomaly (a skill violation the user should see) rather than an RPC error     |
| **R4**  | **`file:line` parsing versus Windows absolute paths.** `D:\projects\x\foo.ts:42` contains a colon at `D:`; a naive `split(':')` mis-parses and AC-5.3 then drops a valid defect                                                                                                                                                                   | The location matcher anchors on a trailing `:\d+(:\d+)?`, never on the first colon. Pinned by a test                                                                                                                              |
| **R5**  | **Relay's implement deliverable is `tasks.md`** (`relay.md:49`), but this repo renamed that document to `batches.md` (`task-spec.contract.ts:107-110`). A conductor following the current root `CLAUDE.md` writes `batches.md`, and a phase-complete check looking only for `tasks.md` reports a finished phase as pending                        | The implement-phase check accepts **either** `BATCHES_FILE` or `LEGACY_BATCHES_FILE`. Both names come from the shared contract, not literals                                                                                      |
| **R6**  | **The Crucible estimate depends on a round cap set in a later wizard step.** The roster step cannot show an exact figure                                                                                                                                                                                                                          | The roster step shows the cap-2 figure labelled "at the 2-round cap"; the Run step shows the exact figure. Consistent with the existing estimate disclaimer (NFR-7)                                                               |
| **R7**  | **`StepPickMoveComponent` gaining discovery makes the wizard's first paint depend on an RPC.** A slow `agent:getConfig` would delay the move cards, which today paint instantly                                                                                                                                                                   | All five cards render immediately as enabled; the Crucible disable is applied only once discovery resolves — cards may go enabled → disabled-with-reason, never the flash in reverse                                              |
| **R8**  | **Judge-authored markdown is untrusted vendor output.** The mentor note goes through DOMPurify, but regex-extracted defect strings could carry markdown-link payloads                                                                                                                                                                             | Defect `what` / `expected` render as **interpolated text**, not markdown. DOMPurify would strip it anyway; interpolation is the cheaper and stronger guarantee (NFR-4)                                                            |
| **R9**  | **`prepare()` becomes async**, so the wizard has an await between the user's click and the page switch. A double-click could fire two allocations                                                                                                                                                                                                 | `StepRunComponent` disables the button for the duration of the await; the existing `if (this.state.correlationId())` teardown at `tribunal-run.service.ts:46-49` already handles a second prepare                                 |
| **R10** | **TASK_2026_238 (codex adapter path) gates codex-lane QA.** Known and filed; with codex the only installed CLI here, **no end-to-end Relay or Crucible run can be QA'd on this branch** until it lands                                                                                                                                            | Every batch above is unit-testable without spawning a lane. Sequence live QA after 238. Do not attempt CLI delegation for this task                                                                                               |

---

## 7. Team-leader handoff

**Recommended developer**: `frontend-developer` for B0, B2, B3, B4, B5, B6; `backend-developer` for B1; `devops-engineer` (or the orchestrator directly) for B7.

**Complexity**: HIGH. Estimated 14-20 hours. The weight is FR-2 (role assignment) and FR-5 (verdict rendering), as the requirements predicted.

**Critical verification points before implementation** — every API named here is verified; the implementer should re-confirm these five and stop if any disagrees:

1. `tasks:` is in `ALLOWED_METHOD_PREFIXES` at `libs/backend/vscode-core/src/messaging/rpc-handler.ts:85` — **no runtime-guard edit needed**.
2. `RPC_HANDLER_MANIFEST` partitions `RPC_METHOD_NAMES` exactly (`rpc-allowlist.spec.ts`) — the new method **must** be added to `TasksRpcHandlers.METHODS`.
3. Contract-guard Duty 1 forbids the `round-N-judge.md` literal outside `task-spec.contract.ts` (`contract.guard.spec.ts:154-186`).
4. `file:read` is Electron-only (`manifest.ts:318-320` + the VS Code profile) — do **not** reach for it as a shortcut.
5. `MarkdownBlockComponent` is already provided app-wide (`app.config.ts:72`); import the component, do not add a second `provideMarkdownRendering()`.

**Definition-of-done items this plan does not close**, carried forward from the requirements: B7's clean-profile verification, the public-docs follow-up (§10), and the CI-wiring DEVOPS task for `generate-content-manifest.js`.
