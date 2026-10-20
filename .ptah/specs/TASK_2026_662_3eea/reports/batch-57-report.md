# Batch 57 report

## Deleted manifest

All paths below are relative to the worktree. Deleted exactly these 32 files and removed the now empty `diagnostics/` and `suggestions/` directories:

- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/eligibility-histogram.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/eligibility-histogram.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.live-poll.integration.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-triggers-settings.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-triggers-settings.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-triggers-settings.parity.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-trigger-toggle.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-trigger-toggle.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/suggestions/skill-suggestions-view.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/suggestions/skill-suggestions-view.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-digest-panel.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-digest-panel.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-invocations-panel.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-invocations-panel.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-stats-strip.component.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-stats-strip.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-rpc.service.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-rpc.service.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-diagnostics-state.service.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-live.service.spec.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-live.service.ts`

## Precondition `rg` results

Before deletion, searched each stem through `libs apps tools` with `rg -n` and checked exported class names across TypeScript source. Internal imports in the candidate set and `src/index.ts` exports were excluded when deciding liveness. Historical `tools/mcp-bench` JSON path inventories are data, not importers.

| Candidate stem | Importers outside deletion set |
| --- | --- |
| `eligibility-histogram` | None; imported by deleted `skill-pipeline-status.component.ts:18`. |
| `event-feed` | None for this library; `memory-curator-ui` has its own `event-feed.component.ts` and local import at `memory-diagnostics-accordion.component.ts:27`. |
| `skill-activity-feed` | None; imports are within deleted diagnostics subtree. |
| `skill-trigger-toggle` | None; imports are within deleted diagnostics subtree. |
| `skill-triggers-settings` | None; imports are within deleted diagnostics subtree. |
| `skill-candidates-table` | None; only its specs and `src/index.ts` export. |
| `skill-digest-panel` | None; only its specs and `src/index.ts` export. |
| `skill-invocations-panel` | None; only its specs and `src/index.ts` export. |
| `skill-pipeline-status` | None; only its specs and `src/index.ts` export. |
| `skill-settings-panel` | None; only its specs and `src/index.ts` export. |
| `skill-stats-strip` | None; only its specs and `src/index.ts` export. |
| `skill-suggestions-view` | None; only its spec and `src/index.ts` export. |
| `skill-diagnostics-rpc` | None; imports are within deleted diagnostics components/services/specs. |
| `skill-diagnostics-state` | None; imports are within deleted components/services/specs. |
| `skill-synthesis-live` | None; imports are within deleted diagnostics integration spec and service spec. |

## Kept (live importer)

None of the deletion candidates. `SkillSynthesisRpcService` stays for the Library and batch 58; its `src/index.ts` export remains. `SkillSynthesisStateService` also stays.

## State API removal

Removed candidate list, selected candidate/detail, invocation, statistics, suggestion list/detail, queue/drain, stage spend and digest signals/computeds; status and scope filters; `SkillStatusFilter`, `RefreshDigestOptions`, suggestion normalizer, and candidate filter mapping. Removed `refreshCandidates`, `selectCandidate`, `loadCandidateDetail`, `promote`, `reject`, `rejectBulk`, `promoteBulk`, `rejectByPattern`, `loadStats`, `setStatusFilter`, `setScopeFilter`, `refreshSuggestions`, `loadSuggestionDetail`, `clearSuggestionDetail`, `updateSuggestion`, `accept`, `dismiss`, `refreshQueue`, and `refreshDigest`. Removed their type imports and the obsolete exports from `src/index.ts`, including `SkillCandidateAction` and `SkillStatusFilter`.

The retained state spec covers both settings switches and now covers spec listing, harvest, and archive cleanup. Deleted assertions for candidate, suggestion, queue and digest behavior.

## Preserve-list check

| Kept member | Live use |
| --- | --- |
| `skillsEnabled` | Internal `skillsPaused` computed in the state service; state spec and thoth-shell spec fake `:69`. |
| `skillsEnabledCommitted` | `skills-pause-switch.component.ts:127,148`; thoth-shell spec fake `:70`. |
| `skillsPaused` | `skill-synthesis-tab.component.ts:124`; thoth-shell spec fake `:71`. |
| `skillsSwitchSaving` | `skills-pause-switch.component.ts:129`; thoth-shell spec fake `:72`. |
| `skillsSwitchError` | `skills-pause-switch.component.ts:130`; thoth-shell spec fake `:73`. |
| `refreshSkillsEnabled` | `skills-pause-switch.component.ts:159,172`; thoth-shell spec fake `:74`. |
| `setSkillsEnabled` | `skills-pause-switch.component.ts:182`; thoth-shell spec fake `:75`. |
| `markSkillsPaused` | `skill-synthesis-tab.component.ts:156`; thoth-shell spec fake `:76`. |
| `telemetryEnabled` | `skill-synthesis-tab.component.ts:125`; thoth-shell spec fake `:77`. |
| `telemetrySaving` | `skill-synthesis-tab.component.ts:126`; thoth-shell spec fake `:78`. |
| `telemetryError` | `skill-synthesis-tab.component.ts:127`; thoth-shell spec fake `:79`. |
| `refreshTelemetryEnabled` | `skill-synthesis-tab.component.ts:145`; thoth-shell spec fake `:80`. |
| `setTelemetryEnabled` | `skill-synthesis-tab.component.ts:152`; thoth-shell spec fake `:81`. |
| `specs` | `skill-specs-control.component.ts:29`; thoth-shell spec fake `:83`. |
| `specsLoading` | `skill-specs-control.component.ts:30`; thoth-shell spec fake `:84`. |
| `staleSpecCount` | `skill-specs-control.component.ts:31`; thoth-shell spec fake `:85`. |
| `refreshSpecs` | `skill-specs-control.component.ts:34`; thoth-shell spec fake `:86`. |
| `harvestSpecs` | `skill-specs-control.component.ts:38`; thoth-shell spec fake `:87`. |
| `clearStaleSpecs` | `skill-specs-control.component.ts:42`; thoth-shell spec fake `:88`. |

Also kept `telemetryEnabledCommitted` for existing settings behavior and tests, `error` for the spec RPC methods, and `SKILLS_PAUSED_REASON` / `SKILLS_PAUSED_NOTICE` for `components/clones/skill-clones-view.component.ts:67-68`. The only external `SkillSynthesisStateService` spec fake is in thoth-shell; its members match the retained API, so no out-of-scope edit is needed. The Library clone components use `SkillClonesStateService` for clone state.

## Decisions

- Delete the skill synthesis `event-feed` despite same-stem hits in `memory-curator-ui`: those imports resolve to that library's local file. Options were to retain or delete; source import paths support deletion. Reversible through version control.
- Keep the shared spec RPC error signal and pause notice constants: spec methods and the clone view still use them. Options were to remove or keep; direct source references support keeping. Reversible.
- Keep batch 58's RPC facade untouched: the batch boundary assigns it later. Reversible.

## Verification and unfinished work

`ptah_ast_analyze` reports parse status `ok`, zero error nodes for the edited state service, state spec, and `src/index.ts`. Post-delete `rg` found no remaining source imports of deleted files or class names; one tab spec asserts absence of the old stats strip. No test, typecheck, lint, build, Nx, or Jest command was run, per task instruction. Compiler diagnostics were not requested because they may invoke TypeScript checking. No known unfinished Batch 57 work.
