# Follow-up task — 620 recordings, first recorded scorecard, matcher labels

User decision 2026-10-09: the 620 PR ships the product changes and the committed bench without
recordings. Everything that depends on a live recording moves to this follow-up task, opened after the
619 (#672) and 620 PRs merge. Create it as its own task folder at that time; this file is the brief.

## State at hand-off

- The record path works end to end: one-case probe `extraction-probe-7` passed with the cassette and
  its provenance sidecar accepted (commits 8dde20076, 7b941759f, 62213ce8d, 770210092, ed40a8b30,
  11e8afa1e and the close-out fix round).
- `extraction-record-v1` was started 2026-10-09 ~14:38Z and left running; it is slow (~0.4 entries/min
  on the long-transcript cases). Its staged cassette is private bench data
  (`%LOCALAPPDATA%\ptah-mcp-bench\cassettes\memory\extraction.v1.jsonl`); check its run dir
  (`runs\extraction-record-v1`) for `run-summary.json` / `recording-rejection.json` before reusing it.
- Private plans: `%LOCALAPPDATA%\ptah-mcp-bench\plans\{extraction.record,b18-record,scope-write.record,funnel-record.plan}.json`.
- Command: `npx nx run mcp-bench:bench-memory-skills -- --plan <abs> --run-id <id> --codex-auth-source <codex auth.json>`.
  Coordinate the bench window with the 619 session; one run at a time.

## Work

1. **Gate hardening first (review defect 3, `code-logic-review-model-free-resolve.md`).** The
   provenance gate counts dispatches in aggregate, so a retry dispatch can cover an entry that made no
   call. Correlate per call in the bench: the double snapshots the collector's dispatch count around each
   inner call and rejects an entry with zero dispatches. Must land before the b18, scope-write and funnel
   recordings.
2. **Recordings**, one at a time: extraction (reuse `extraction-record-v1` if accepted), `b18-record-v1`,
   `scope-write-record-v1`, `funnel-record-v1`. Copy accepted cassettes into the committed fixtures and
   replay once.
3. **Batch 24** (`batches.md:840`): CI workflow `memory-skills-bench.yml`, first recorded run on Windows
   and Linux/WSL (R9, R11), `known-failures.v1.json`, ledger `feature-evidence.md`.
4. **U3**: matcher sample (≥ 100 pairs, ≥ 40 true matches) from the Batch 24 replay run, labelled by the
   cross-family model panel (two non-OpenAI raters + a third-family adjudicator; check `ptah_agent_list`).
   Then `matcher-sample.v1.jsonl` and the R-M4 gate.
5. **Batch 26** (`batches.md:892`): re-run, tighten known failures, update the ledger.
6. **Phase 4 product seams** the bench found (`HANDOFF.md` "Phase 4 seams") — separate product tasks.
