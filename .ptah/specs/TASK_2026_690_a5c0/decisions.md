# Decisions — TASK_2026_690_a5c0

| ID | Decision | Source | Evidence |
| --- | --- | --- | --- |
| D1 | No code change for the reported two scrollbars / gap under the composer: the new build (Batches 1-4) has one transcript scroller and the composer at the host bottom. | Measurement | `reports/layout-measurement.md` |
| D2 | Hide the "Display · N" bar until the session has its first display panel or turn summary (or the sheet is open). | User (AskUserQuestion, 2026-10-17) | `reports/layout-measurement.md` |
| D3 | In the Canvas sub-agent lane, the agent card fills the lane height with one scroller; inline transcript cards keep the 320 px cap. | User (AskUserQuestion, 2026-10-17) | `reports/layout-measurement.md`, `inline-agent-bubble.component.ts:446`, `canvas-lane-view.component.ts:174-201` |
| D4 | Dev-app rebuild skips `rebuild-native` while another Electron app holds the shared `better_sqlite3.node`; the module is already built for Electron 44.4.3. | Evidence | `EBUSY` in `.ptah/tmp/690-dev-build3.log` |
