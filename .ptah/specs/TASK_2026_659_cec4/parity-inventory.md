# Parity inventory - TASK_2026_659_cec4: skills trajectory capabilities

Every decision is a PROPOSAL for the user. "keep" = stays as is; "move" = stays but is re-pointed into the
TASK_2026_646_136a outcome record or capability matrix; "remove-proposed" = switch off now, delete after the
user approves. Evidence refers to `evaluation-report.md` sections (same folder).

Path abbreviations: `SS` = `libs/backend/skill-synthesis/src/lib`, `UI` = `libs/frontend/skill-synthesis-ui/src/lib`,
`RH` = `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts`,
`UL` = `libs/backend/agent-generation/src/lib/services/user-layer`, `FSK` = `libs/backend/platform-core/src/file-settings-keys.ts`.

## Recording and telemetry

| Capability | Where today | Backing RPC / API | Decision | Reason with evidence |
| --- | --- | --- | --- | --- |
| Subagent invocation events (tokens, duration, tools, task id) | `SS/triggers/skill-trigger.service.ts:506-514`; `SS/skill-invocation-recorder.ts:35-62`; `SS/skill-candidate.store.ts:1195` | `skillSynthesis:invocationStats`, `getScorecards`, `getScorecardDetail` | **move** (into 646 outcome record, Req 5.4) | 6,174 subagent rows, 4,543 with task id; the only per-agent data that exists (Value §7) |
| Prompt-expansion / Skill-tool load events | `skill-trigger.service.ts:574-581,671-678` | same | **keep + fix** (add `skillsLoaded` to outcome record) | Needed for the Use metric; no Skill-tool source rows exist today (Unknowns) |
| `succeeded` flag on events | `skill-trigger.service.ts:510,675` (hard-coded true) | – | **remove-proposed** (replace with 646 verdicts) | 6,295 of 6,295 ungraded rows = 1 (Value §7) |
| Spec harvester reconciliation | `SS/spec-harvester.service.ts:103-112`; store `:1354-1421` | `listSpecs`, `harvestSpecs`, `clearStaleSpecs` | **move** (write 646 review verdicts) | Only producer of graded rows (81) |
| `skill_invocations` + `SkillInvocationTracker` | `SS/skill-invocation-tracker.ts:48-84`; store `:1134-1144` | `skillSynthesis:invocations` | **remove-proposed** | 0 rows; no production caller (grep); 2,433 rows deleted by cleanup |
| Session verdicts (archaeology output) | `skill_session_verdicts` table | – | **remove-proposed** | 262 rows; 106 "unverified", 79 null evidence class |

## Synthesis pipeline

| Capability | Where today | Backing RPC / API | Decision | Reason with evidence |
| --- | --- | --- | --- | --- |
| Prefilter stage | queue stage `prefilter`; `SS/queue/stage-handlers.service.ts` | `skillSynthesis:queue`, `analyzeNow` | **remove-proposed** | $7.54, 712 attempts, 1,243 still queued (Cost §1-2) |
| Archaeology | `SS/session-archaeologist.service.ts:383` | – | **remove-proposed** | $11.05 (largest stage); output feeds only candidates |
| Synthesis (candidate authoring) | `SS/skill-synthesizer.service.ts:288` | – | **remove-proposed** | 2,692 single-session candidates, 0 uses |
| Judge | `SS/skill-judge.service.ts:171` | – | **remove-proposed** | Judge 7.8-8.4 vs human 1.25-2.38 (Value §4) |
| Judge panel | `SS/gates/judge-panel.service.ts:512` | – | **remove-proposed** | $6.89; 14 unscored (bad JSON / timeout) |
| Replay gate | `SS/gates/replay-validator.service.ts:423` | – | **remove-proposed** | Never produced a result (620 forensics) |
| Trigger eval | `SS/gates/trigger-eval.service.ts:597` | – | **remove-proposed** | $4.00; 22 lane failures |
| Embedding + clustering (local) | `SS/skill-clustering.service.ts`; vector tables | – | **remove-proposed** | Clusters are generic (max 265) or size 1 (Value §5) |
| Curator (suggestions, reconcile) | `SS/skill-curator.service.ts:264-268,440` | `runCurator`, `listSuggestions`, `getSuggestion`, `updateSuggestion`, `acceptSuggestion`, `dismissSuggestion` | **remove-proposed** | 25 suggestions, 2 accepted, 0 uses |
| Promotion + gates | `SS/skill-promotion.service.ts:281-324`; `skill-synthesis.service.ts:1446-1501` | `promote`, `promoteBulk`, `reject`, `rejectBulk`, `rejectByPattern`, `pin`, `unpin` | **remove-proposed** | 2 promotions, 0 uses; auto path dead |
| Candidate store and listing | `SS/skill-candidate.store.ts` | `listCandidates`, `getCandidate`, `stats`, `diagnostics`, `digest` | **remove-proposed** | Serves only the retired pipeline |
| Lane routing for synthesis stages | `SS/lanes/skill-lane-config.ts:34-149`; `SS/lanes/lane-runner.service.ts` | `setLanes`, `getLanes` | **remove-proposed** (646 owns routing) | 32 settings keys for 4 internal lanes |
| Budget table | `SS/skill-budget.store.ts:281-290` | – | **remove-proposed** (646 records cost per run) | Daily aggregates only; misses enhance and cache tokens |
| Lane trajectories (synthesis on lane sessions) | planned, TASK_2026_536 | – | **remove-proposed** (cancel task) | Would feed the retired pipeline |

## Background jobs and settings

| Capability | Where today | Backing RPC / API | Decision | Reason with evidence |
| --- | --- | --- | --- | --- |
| Drain crons frequent / nightly / weekly | `libs/backend/thoth-runtime/src/lib/skill-drain-jobs.ts:40-65`; `start-thoth-cron.ts:56-120` | `scheduled_jobs` rows | **remove-proposed** | 3,078 runs; 4 stuck `running`; weekly 8.84 h wall |
| Backlog cleanup / purge | `thoth-runtime/src/lib/skill-backlog-cleanup-job.ts:23-26`; `SS/cleanup/*` | – | **remove-proposed** | 37 failed `unexpected-error`; exists to clean the pipeline's own output |
| Idle / boot-scan / hook triggers | `SS/triggers/skill-trigger.service.ts:309,376,400,441` | `setTriggers`, `getTriggers` | **remove-proposed** (keep only the event recording above) | Triggers start analysis runs |
| Pause switches | TASK_2026_620 (`feb688ccb`, `dc48896f3`) | settings | **keep** (use them now for Step 0) | Reversible off switch |
| `skillSynthesis.*` settings (~55 keys) | `FSK:255-401,569-692` | `getSettings`, `updateSettings` | **remove-proposed** except pause | All on by default |

## Library, clones and agents

| Capability | Where today | Backing RPC / API | Decision | Reason with evidence |
| --- | --- | --- | --- | --- |
| User-layer clones of skills, agents, commands | `UL/user-layer-mirror.service.ts`; `skill_registry` table | `listClones`, `getClone`, `saveCloneBody`, `keepClone`, `rebaseClone` | **keep** | User edits of shipped content; 50 registry rows |
| History snapshots and revert | `UL/user-layer-mirror.service.ts:694,774,907-935` | `getHistoryBody`, `revertEnhancement` | **keep**, reduce bulk snapshots later | 832 snapshot files, mostly bulk sync (Value §8) |
| Quarantine restore | `UL/user-layer-seed-quarantine.ts:553` | `listQuarantinedAgents`, `restoreQuarantinedAgent` | **keep** | Protects user agents; part of harness safety |
| "Enhance now" (auto rewrite) | `SS/skill-enhancer.service.ts:804-907` | `enhanceNow`, `previewEnhancement`, `applyProposal` | **remove-proposed** (or manual draft only, no auto-apply) | 2 rewrites, cost untracked, effect not measurable |
| Agent model picker | `RH` | `getAgentModels`, `setAgentModel` | **remove-proposed** with enhance; per-agent model choice moves to 646 matrix | RPC timeout in the user's screenshot |
| Agent scorecard badge (tokens, cost, verdict dots) | `UI/components/clones/scorecard-badge.component.ts:25-79` | `getScorecards`, `getScorecardDetail` | **move** (read 646 outcome records) | 646 Req 9.4 keeps it |
| Agent "Success" % | `UI/.../clone-card.component.ts:413-420`; `clone-detail-drawer.component.ts:559-560`; `RH:2305` | `invocationStats` | **remove-proposed** (already a 646 Proposed Removal) | 100% by construction |
| Shipped skill delivery to Claude (`~/.ptah/skills`) | harness / plugin layer | – | **keep** | Authored skills are used (30 slugs) |
| Harness sync to codex / copilot / opencode | `libs/backend/harness-sync` (13,284 LOC) | harness RPCs | **keep** | Distributes authored content; separate from synthesis |
| 2 promoted skills | `~/.ptah/skills/execute-phase-gated-task`, `.../extract-and-relocate-angular-component-feature` | – | **remove-proposed** (first); user choice (second) | 0 loads since 2026-10-04 |

## UI (Thoth panel)

| Capability | Where today | Backing RPC / API | Decision | Reason with evidence |
| --- | --- | --- | --- | --- |
| Recommended tab | `UI/.../skill-synthesis-tab.component.ts:930-934` (`suggestions`) | suggestion RPCs | **remove-proposed** | Shows single-session items |
| Sessions tab | same (`candidates`) | candidate RPCs | **remove-proposed** | 414 single-session candidates |
| Library tab | same (`clones`) | clone RPCs | **keep** (Skills, Agents, Commands), without Enhance | User content management |
| Activity tab | same (`activity`) | `queue`, `digest` | **remove-proposed**, or re-point to 646 outcome records | Shows pipeline queue |
| Settings tab | same (`settings`) | `getSettings`, `updateSettings` | **remove-proposed** except pause / telemetry toggle | ~87 keys |
| Synthesis counters (Candidates, Promoted, Rejected, Active, Invocations) | UI header | `stats` | **remove-proposed**, replace with Use / Lift per skill | Counters measure activity, not value |

## Shared with memory (out of scope, do not touch)

| Item | Note |
| --- | --- |
| `observation_queue` (101,892 rows) | Memory capture; not used by the synthesis stages measured here |
| `persistence-sqlite` migrations | Skill migrations would need a down-path or tombstone; memory migrations unaffected |
| `thoth-runtime` cron host | Hosts memory retention too; remove only the skill job registrations |
