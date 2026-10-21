# Task 53.2 report

## Pre-edit `rg` result

Command: `rg -n "judging-enhancement|'archaeologist'|'synthesis'|'judge'|'replay'" libs/frontend apps`

Every hit follows. None uses these IDs as a `PendingSettingsTab.section` value or in `requestSettingsTab`.

| File:line | Why unrelated |
| --- | --- |
| `apps/ptah-landing-page-e2e/src/support/db.ts:433` | Comment about recorded session state. |
| `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.spec.ts:310` | Queue item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.spec.ts:314` | Queue item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.spec.ts:332` | Queue item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.spec.ts:355` | Queue item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.spec.ts:265` | Lane ID fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-rpc.service.spec.ts:304` | Lane key assertion. |
| `apps/ptah-landing-page-e2e/src/specs/members-live.spec.ts:281` | Recorded session state assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:293` | Pipeline item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:303` | Pipeline label assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:315` | Pipeline item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:347` | Pipeline item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:382` | Pipeline item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:410` | Stage spend fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:475` | Pipeline item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:476` | Pipeline item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:478` | Stage spend fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:484` | Stage label assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:496` | Pipeline item stage fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-pipeline-status.component.spec.ts:513` | Stage spend fixture. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.ts:73` | Candidate gate key type. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.ts:646` | Candidate gate display. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts:488` | Candidate gate helper type. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts:501` | Candidate gate assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts:509` | Candidate gate assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts:529` | Candidate gate assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts:531` | Candidate gate assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts:589` | Candidate gate assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts:598` | Candidate gate assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts:606` | Candidate gate assertion. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-candidates-table.component.spec.ts:617` | Candidate gate assertion. |
| `libs/frontend/core/src/lib/services/app-state.service.ts:140` | Legacy union member targeted for deletion. |
| `libs/frontend/core/src/lib/services/app-state.service.ts:141` | Legacy union member targeted for deletion. |
| `libs/frontend/core/src/lib/services/app-state.service.ts:142` | Legacy union member targeted for deletion. |
| `libs/frontend/core/src/lib/services/app-state.service.ts:143` | Legacy union member targeted for deletion. |
| `libs/frontend/core/src/lib/services/app-state.service.ts:144` | Legacy union member targeted for deletion. |
| `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.ts:33` | Tribunal role constant. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-run.service.spec.ts:211` | Tribunal role fixture. |
| `libs/frontend/tribunal-panel/src/lib/types/tribunal-ui.types.spec.ts:45` | Tribunal role assertion. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-roster-rules.ts:101` | Tribunal role lookup. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-roster-rules.spec.ts:29` | Tribunal lane fixture. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-roster-rules.spec.ts:143` | Tribunal diagnostic assertion. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-roster-rules.spec.ts:149` | Tribunal lane fixture. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-roster-rules.spec.ts:161` | Tribunal lane fixture. |
| `libs/frontend/tribunal-panel/src/lib/services/tribunal-progress.service.spec.ts:67` | Tribunal role fixture. |
| `libs/frontend/command-center/src/lib/scene/scene-layout.spec.ts:165` | Command center lane fixture. |

## Union before

```ts
section?:
  | 'main-agent'
  | 'main-model'
  | 'main-effort'
  | 'connections'
  | 'background-models'
  | 'cli-agents'
  | 'more-providers'
  | 'memory-curator'
  | 'enhancement'
  | 'archaeologist'
  | 'synthesis'
  | 'judge'
  | 'replay'
  | 'judging-enhancement';
```

## Union after

```ts
section?:
  | 'main-agent'
  | 'main-model'
  | 'main-effort'
  | 'connections'
  | 'background-models'
  | 'cli-agents'
  | 'more-providers'
  | 'memory-curator'
  | 'enhancement';
```

## Clarifications Needed

none

No tests, typecheck, lint, build, serve, or e2e were run, as instructed.
