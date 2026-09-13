# Implementation plan — TASK_2026_431

Scope: `apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/{agent-lanes,orchestration,tribunal}`,
`content-manifest.json`, two guard specs, and links broken by moves. No frontend code.

## Verified facts the design rests on

| Fact | Evidence |
|---|---|
| Lane tool contracts: `ptah_agent_spawn` params `task` (only required), `cli` (enum = shipped adapters, not installed set), `ptahCliId` (cli ignored when set), `model`, `modelTier` (ptah-cli only), `workingDirectory`, `timeout` (default = max = 1h), `files`, `taskFolder`, `resume_session_id` | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts:494-591` |
| `ptah_agent_status` statuses `running/completed/failed/timeout/stopped`; `CLI Session ID` only when the adapter reports one | same file `:597-618`; `mcp-response-formatter.ts:555-591` |
| `ptah_agent_list` columns `Agent / Type / Status / Capabilities`; cli status `installed / not installed / disabled / disabled (installed)`; ptah-cli rows carry `provider:`, `ptahCliId:`, `messaging:` | `mcp-response-formatter.ts:464-518` |
| `ptah_agent_message` returns `mode` `steer / interrupt-resume (partial turn discarded) / queue-next-turn / unsupported`; `ptah_agent_report` returns `delivered:false` + `reason`; rate-limited | `tool-description.builder.ts:666-730` |
| Team-leader returns end in `### Next action:` lines; headings are `DECOMPOSITION COMPLETE/BLOCKED`, `BATCH [N] PARTIAL FAILURE`, `NEEDS REVIEW`, `BATCH [N] NOT ACCEPTED`, `BATCH [N] COMPLETE`, `ALL BATCHES COMPLETE`, `TASK COMPLETE`; deliverable is `batches.md`; status `IN_PROGRESS` | `libs/backend/agent-generation/templates/agents/team-leader.template.md:83-500` |
| Skill copy says `NEXT BATCH ASSIGNED`, `BATCH REJECTED`, `tasks.md`, `IN PROGRESS` — contradicts the template the orchestrator actually talks to | `orchestration/SKILL.md:267-271`, `team-leader-modes.md:195-226` |
| Every generated subagent already carries the delegation rules via `_shared/cli-delegation.md` | `templates/agents/_shared/cli-delegation.md` |
| Skills install as flat siblings `<root>/skills/<slug>/` in every target | `harness-sync/src/lib/targets/claude-target.ts:68`, `rival-targets.ts:106,123,147,160`, `workspace-target.ts:352` |
| A user can drop one skill three ways: per-workspace selection, plugin gate, `disabledSkillIds` | `harness-sync/src/lib/manifest/harness-manifest.builder.ts:228-321` |
| Mirror fast-forward clears tracked clone content before copying, so a deleted reference disappears from `~/.ptah/user`; a *diverged* (user-edited) clone keeps it | `agent-generation/src/lib/services/user-layer/user-layer-mirror.service.ts:1380-1396` |
| `ContentDownloadService.pruneStaleFiles` deletes files the manifest omits from `~/.ptah/plugins` | `content-download` service `:377` |
| Already-shipped Tribunal UI tells the conductor `Read the tribunal skill's references/relay.md` | `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.ts:91-94,338` |
| Plugin content downloads from GitHub at runtime, so older app builds receive the new skill text | root `CLAUDE.md` Marketplace section |
| Skill frontmatter carries `name` + `description` only | `skill-creator/SKILL.md:305-316` |
| `vendor-roster-drift.spec.ts` pins the disclaimed roster sample to `orchestration/references/cli-agent-delegation.md` | `vscode-lm-tools/src/lib/code-execution/vendor-roster-drift.spec.ts:337-348` |
| `contract.guard.spec.ts` scans the orchestration dir for per-task doc names | `task-specs/src/lib/contract.guard.spec.ts:231-282` |

## Target file tree

```
ptah-core/skills/
├── agent-lanes/                     NEW
│   └── SKILL.md                     the lane contract (≤150 lines)
├── orchestration/
│   ├── SKILL.md                     router (≤7KB)
│   └── references/
│       ├── strategies.md            per-type flows only
│       ├── checkpoints.md           every gate + clarification loop + templates
│       ├── team-leader-modes.md     how to act on team-leader returns (matches template)
│       ├── task-tracking.md         task.md contract, ID allocation, phase detection
│       ├── agent-catalog.md         matrices, invocation, deliverables, one row per agent
│       ├── lane-assignment.md       NEW — who spawns, executor recs, per-role hand-offs, fully-laned run
│       ├── git-standards.md         commit format + hook protocol (unchanged)
│       └── cli-agent-delegation.md  DELETED (transport → agent-lanes, rest → lane-assignment)
└── tribunal/
    ├── SKILL.md                     panel policy, four moves, Relay pointer
    └── references/
        ├── vendor-panel.md          explicit panel, panelist, selection, anonymization, synthesis
        ├── council.md / forge.md / race.md   move protocols, transport cited
        ├── crucible.md              rubric, judge contract, gates; roster + ID cited
        └── relay.md                 compatibility pointer (≤25 lines)
```

## What each file owns

| File | Owns | Must not contain |
|---|---|---|
| `agent-lanes/SKILL.md` | discovery and reading the list; `cli` / `ptahCliId` / `model` / `modelTier` addressing; the self-contained task contract; spawn → status → read; stop; concurrency default 3; resume only on `CLI Session ID`; failure handling; review independence (reviewer ≠ author, different family preferred, same-family flagged); two-round revise cap; lane output is evidence, the build is proof; messaging a live lane (`mode` / `delivered` contract); cost announcement | any workflow, phase, move, roster |
| `orchestration/SKILL.md` | triggers, pre-flight, strategy table, NEW/CONTINUATION mode, gate table, team-leader response rule, the non-negotiables, reference index with load conditions | lane mechanics, checkpoint templates, ID algorithm steps |
| `strategies.md` | per-type flows, conditional agents, SAAS_INIT + CREATIVE detail | per-phase "CLI delegation opportunities" (one home: lane-assignment per-role table) |
| `checkpoints.md` | checkpoint table, triggers/skips, templates, subagent clarification loop, rejection/verification handling | commit hook template (→ git-standards) |
| `team-leader-modes.md` | invocation per mode; mapping from team-leader return heading to orchestrator action; parallel fan-out step | batch file schema, executor heuristics (template owns both) |
| `task-tracking.md` | ID format + allocation (sole home in the corpus), `task.md` contract and ONE template, folder layout, registry, phase detection, status vocabularies | bug history |
| `agent-catalog.md` | capability matrix, selection matrix, invocation table, deliverable filenames, one-row profiles, visual-review checklist, QA parallel patterns | delegation rules |
| `lane-assignment.md` | spawn authority (resolved contradiction), Checkpoint 0.1 outcome → prompt block, team-leader executor recommendations, per-role hand-off table, never-delegate list, fully-laned run (ex-Relay) incl. roster pinning | transport mechanics (cites agent-lanes) |
| `tribunal/SKILL.md` | when to use, preflight, four moves, Conductor role, where Relay went, requires | transport, ID algorithm |
| `vendor-panel.md` | explicit UI panel handling, panelist/family model, deterministic selection, anonymization, synthesis, round cost | spawn/poll/read loop, resume, concurrency default (cites agent-lanes) |
| `crucible.md` | rubric, judge output contract, flow, gates, variants | lane addressing table, ID steps, revise cap wording (cites) |

## Every duplicated rule and its single home

| Rule | Copies today (before) | Home |
|---|---|---|
| Discover via `ptah_agent_list`, read rows, skip non-installed | `orch/SKILL.md:306,352`; `cli-agent-delegation.md:66-88,411-431`; `vendor-panel.md:56-58,62-66`; `relay.md:62-80`; `crucible.md:41,49`; `tribunal/SKILL.md:26-31` | `agent-lanes` §Discover |
| `cli` vs `ptahCliId` addressing, `model` / `modelTier` | `cli-agent-delegation.md:105-122,415-420`; `vendor-panel.md:44-60`; `relay.md:66-73` | `agent-lanes` §Address |
| Self-contained prompt, deliverable line, `WROTE:` reply | `orch/SKILL.md:164-179,367`; `cli-agent-delegation.md:148-192,451-457`; `vendor-panel.md:75`; `relay.md:34,127` | `agent-lanes` §Task contract (subagent `Task()` contract stays in `agent-catalog.md` — different transport) |
| Spawn → poll → read | `orch/SKILL.md:350-356`; `cli-agent-delegation.md:92-144,196-236`; `vendor-panel.md:73-92`; `relay.md:122-134`; `crucible.md:121-133` | `agent-lanes` §Run |
| Concurrency 3 | `orch/SKILL.md:319,366`; `cli-agent-delegation.md:198-200,313-320`; `vendor-panel.md:68,78,124`; `tribunal/SKILL.md:73` | `agent-lanes` §Run (tribunal keeps only "Council may widen with consent") |
| Resume (conditional on `CLI Session ID`) — unconditional in `orch/SKILL.md:358-362,374` and `cli-agent-delegation.md:278,326-330`, conditional elsewhere | `cli-agent-delegation.md:324-407`; `vendor-panel.md:96`; `relay.md:79,136,158`; `crucible.md:135`; `forge.md`, `race.md` | `agent-lanes` §Recover — conditional form (matches `ptah_agent_status` contract) |
| Fail twice → drop/reassign | `vendor-panel.md:97`; `relay.md:136`; `forge.md`; `race.md` | `agent-lanes` §Recover |
| Named lane missing → say so, don't substitute | `cli-agent-delegation.md:309-311,431`; `relay.md:104`; `crucible.md:49` | `agent-lanes` §Discover |
| Review independence (not self, different family, same-family flagged) | `orch/SKILL.md:370`; `cli-agent-delegation.md:36-46,428`; `relay.md:54,84-85`; `crucible.md:37,53` | `agent-lanes` §Verify |
| Two revise rounds then in-house | `orch/SKILL.md:372`; `cli-agent-delegation.md:48-56`; `crucible.md:110-112,153`; `tribunal/SKILL.md:57` | `agent-lanes` §Verify; Crucible keeps its "3rd only on user request" extension, citing the cap |
| A lane's PASS is not proof | `cli-agent-delegation.md:62`; `crucible.md:30,151,183` | `agent-lanes` §Verify |
| Lanes never commit / never ask the user | `orch/SKILL.md:369`; `cli-agent-delegation.md:172,488-489`; `relay.md:31-34,140` | `agent-lanes` §Task contract |
| Every spawn is a paid call; announce before spending | `tribunal/SKILL.md:74`; `vendor-panel.md:125`; `relay.md:116`; `crucible.md:117` | `agent-lanes` §Cost |
| Task-ID allocation | `orch/SKILL.md:138-140`; `task-tracking.md:184-211`; `relay.md:40-41`; `crucible.md:117` (cites relay) | `task-tracking.md` |
| `task.md` template | `task-tracking.md:42-63` and `:221-237` | `task-tracking.md` (once) |
| Checkpoint ownership + doc-review-as-plain-message + clarification loop | `orch/SKILL.md:53,57-69,198-251`; `checkpoints.md:5-9,414-468`; `relay.md:140-143` | `checkpoints.md` |
| Commit hook failure 3-option template | `checkpoints.md:504-541`; `git-standards.md:189-236`; `orch/SKILL.md:394-400` | `git-standards.md` |
| Deliverable filenames | `orch/SKILL.md:181-194`; `agent-catalog.md` profiles; `task-tracking.md:275-288` | `agent-catalog.md` invocation table |
| Team-leader never spawns | `orch/SKILL.md:289-302,380`; `cli-agent-delegation.md:474-478`; `team-leader-modes.md:150-160` (and the template) | `lane-assignment.md` §Who spawns (template owns the agent's own refusal) |
| Per-phase delegation opportunities | `strategies.md` ×7 sections; `cli-agent-delegation.md:459-472` | `lane-assignment.md` per-role table |
| Never-delegate list | `agent-catalog.md:33`; `cli-agent-delegation.md:482-494`; `strategies.md:582` | `lane-assignment.md` |

## Sole-spawner contradiction (`orch/SKILL.md:316` vs `:335`)

Both are partly right. The template partial `_shared/cli-delegation.md` gives most subagents
the spawn loop, and the team-leader template forbids it. Resolution, written once in
`lane-assignment.md`:

- The **orchestrator** is the only spawner of subagents and of batch executors (the work a
  team-leader recommends).
- The **team-leader** spawns nothing.
- **Any other subagent** may spawn CLI lanes for its own sub-tasks when Checkpoint 0.1 left lanes
  `enabled` or `auto`, except the roles on the never-delegate list. It owns what those lanes return.

## Relay decision — fold into orchestration

Relay is orchestration's phase pipeline with every phase assigned to a lane. Its only tribunal
signal (cross-family review) is a general lane rule that now lives in `agent-lanes`. Keeping it
in tribunal meant tribunal restated the ID algorithm, checkpoint gates, the phase deliverable
table and the addressing table — the bulk of the duplication. Decision:

- `orchestration/references/lane-assignment.md` gains **Assigning phases to lanes**: any phase
  (PM, architect, a batch, review) can run on a subagent or a CLI lane; a run where every phase
  is a lane is the old Relay. Roster pinning, the implement≠review rule and the worked example
  move there.
- Tribunal keeps the four moves where diversity or independence is the signal: Council, Forge,
  Race, Crucible.
- `tribunal/references/relay.md` stays as a short pointer. Reason: shipped Tribunal UI builds
  launch Relay with "Read the tribunal skill's references/relay.md", and runtime content download
  delivers this text to those builds. The pointer maps the `(plan|architect|implement|review)`
  role tokens onto lane assignment. It is removed by the UI follow-up.
- Trigger phrases `relay`, `X plans, Y implements, Z reviews` move to the orchestration
  description; tribunal's description keeps `relay` only so UI launches still load the pointer.
- Role-addressed lanes (TASK_2026_433) slot into `lane-assignment.md` as "pass `role`" once the
  parameter exists; no text now promises it.

## Dependency guard — spec + declared requirements, not loader enforcement

Options evaluated:

1. **Loader enforcement** in `HarnessManifestBuilder.buildSkills` (auto-claim required siblings,
   or drop dependents). Auto-claiming overrides an explicit user disable or a per-workspace
   selection, which the three-gate design exists to honour; dropping dependents silently removes
   the default workflow. The Claude-SDK plugin path (`plugin-loader.service.ts` invocability) is
   a second loader that would need the same rule. Two libs, a behaviour change and a UX question.
2. **Spec + declaration + visible fallback** (chosen). Each skill that links a sibling skill
   declares it under a `## Requires` heading (body, not frontmatter — frontmatter is `name` +
   `description` only). The dependent skill tells the model what to do when the sibling is
   missing: say which skill to enable, never improvise the rules.

Spec `libs/backend/harness-sync/src/lib/targets/skill-sibling-links.spec.ts`:

- every relative link in any plugin skill `.md` that leaves its own skill directory resolves to an
  existing file in a sibling skill of the SAME plugin;
- that sibling's slug is listed in the linking skill's `## Requires`;
- every `## Requires` slug exists as a sibling;
- every harness target's `preflightKeys` places two skills as siblings of one directory (pins the
  flat layout the relative links depend on).

Spec `libs/backend/vscode-lm-tools/src/lib/code-execution/lane-rule-single-home.spec.ts`: across
`agent-lanes`, `orchestration`, `tribunal`, each guarded lane-rule pattern (`resume_session_id`,
`CLI Session ID`, default concurrency 3, `2 revise rounds`, `ptahCliId` precedence, a pasted
`ptah_agent_list` row) appears only in `agent-lanes/SKILL.md`, and the home still carries each.

Loader-level warning when a required sibling is disabled → UI follow-up.

## Future sections (not implemented)

- TASK_2026_434 messaging: `agent-lanes` §Talk to a live lane already holds the tool contract; the
  clarification-without-exit, Council-round-2-by-message and Crucible-defects-by-message protocols
  are added there, and workflow skills cite them.
- TASK_2026_433 roles: `agent-lanes` §Address gains `role`; `lane-assignment.md` gains "pass the
  role, never paste a template into `task`".

## Manifest, specs, links

- `npm run manifest:generate` in the same commit as content; `manifest:check` after.
- Update `vendor-roster-drift.spec.ts:337-348` to point the disclaimer exemption at
  `agent-lanes/SKILL.md`.
- `contract.guard.spec.ts` scans orchestration; new names used are in `DOC_FILES`.
- Links: `ptah-core/commands/orchestrate.md` reference list; `apps/ptah-docs` agent-orchestration
  Relay tip only if it links a moved file (it links a docs page, not a skill file — leave);
  `apps/ptah-video-studio/docs/feature-knowledge-base.md` cites `cli-agent-delegation.md` line
  refs — update the path.
- `.claude/skills/{orchestration,tribunal}` is a separately tracked, already-diverged copy for this
  repo's own sessions. Out of scope; reported.

## Before-KB (bytes / 1024)

| File | KB |
|---|---|
| orchestration/SKILL.md | 24.4 |
| orchestration/references/agent-catalog.md | 22.8 |
| orchestration/references/checkpoints.md | 20.9 |
| orchestration/references/cli-agent-delegation.md | 24.9 |
| orchestration/references/git-standards.md | 9.3 |
| orchestration/references/strategies.md | 21.9 |
| orchestration/references/task-tracking.md | 15.6 |
| orchestration/references/team-leader-modes.md | 15.4 |
| **orchestration total** | **155.2** |
| tribunal/SKILL.md | 9.7 |
| tribunal/references/council.md | 3.2 |
| tribunal/references/crucible.md | 15.2 |
| tribunal/references/forge.md | 4.4 |
| tribunal/references/race.md | 4.3 |
| tribunal/references/relay.md | 13.9 |
| tribunal/references/vendor-panel.md | 9.3 |
| **tribunal total** | **60.0** |
| agent-lanes | 0 |
| **ptah-core skills, all `.md`** | **543.5** |

## Verification

- `npx nx run-many -t test -p @ptah-extension/harness-sync @ptah-extension/vscode-lm-tools @ptah-extension/task-specs`
- `npm run manifest:check`, `npm run manifest:self-test`
- lint on the two new/edited spec files
- Walkthrough: a Council and a FEATURE run traced against the slimmed text, recorded in the report.
