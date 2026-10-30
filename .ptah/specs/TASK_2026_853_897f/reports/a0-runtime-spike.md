# A0 controlled runtime spike

Coordinator-retained backend worker findings. Overall: PARTIAL; A0 is not fully accepted.

## Environment and scope

Existing loopback route, reported model `gpt-6.1-sol[1m]`; no provider/model change. Seven completed model calls are counted in sanitized-shapes.json (six message-start events observed in sanitized-stream.json). These are route-specific observations, not proof for all provider/account routes.

Temporary launch options and isolated configuration only. Bubblewrap read-only root prevented permanent home/config writes. Raw runtime directories were removed after sanitized extraction. No production/Git/settings/account edits reported.

## Observations

- Main and generated/built-in general-purpose child request shapes under the six-tool deny policy omit Workflow and ReportFindings schemas. Main baseline includes both. This supports the tested installed-runtime behavior; absent-baseline tools are not evidence of successful exclusion, and child baseline absence/presence must not be invented.
- Parent retained ListAgents, ScheduleWakeup, CronCreate/Delete/List, SendMessage, Monitor, TaskStop, NotebookEdit and spawning. RemoteTrigger was absent at baseline. Child Agent schema remained, but full protected child deferred inventory was not exposed. Child inheritance verdicts are qualified: eager schema exclusion was observed, not complete deferred-tool exclusion.
- Installed Agent SDK 0.3.278; runtime executable 2.1.312. Fixture ran once under the shared verify --exec lock with exit 0. Scoped diagnostics timed out and were UNAVAILABLE; no project verification applies to evidence-only writes.
- Five targeted bundled skills actually present in baseline were hidden: update-config, fewer-permission-prompts, plugin-authoring, workflow-authoring, code-review. keybindings-help and init were absent at baseline and therefore not proven by this run.
- Unknown qualified `anthropic-skills:a0-nonexistent-897f: off` key with settingSources [] allowed startup and successful streamed response on the inherited loopback route.
- Named-account startup/stream: UNAVAILABLE; no named route attached.
- Real account-synced qualified hiding and same-name workspace collision: UNAVAILABLE; no synced account/config attached. No credentials extracted to work around this.

## Retained evidence

All under `evidence/a0-runtime/` in this task folder:
- spike.mjs — reproducible fixture.
- sanitized-stream.json — temporary options, tool/skill inventory and stream/result events.
- sanitized-shapes.json — request schema inventories, per-transcript call counts, cleanup record.

Existing raw-transcript source names in sanitized-shapes.json are provenance, not retained raw files. Raw baseline/denied directories were removed intentionally to avoid retaining private content.

## Remaining gate

Do not mark all assumptions 1–3 PASS. Qualified synced-skill isolation and named-account route remain unavailable. Electron unchanged before screenshots are handled by the independent visual worker and are not established here. Production implementation remains gated pending coordinator disposition of missing evidence.
