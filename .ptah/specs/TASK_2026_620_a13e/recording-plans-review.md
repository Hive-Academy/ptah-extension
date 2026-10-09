# Live recording plans review

## Verdict: REVISE

1. **Blocking — `b18-record.json`: fixture sources and ground-truth paths do not exist.**
   - `C:\Users\abdal\AppData\Local\ptah-mcp-bench\plans\b18-record.json#/fixtures/0/source` references `tools/mcp-bench/fixtures/memory-skills/merge-pairs.v1.jsonl`, which is absent.
   - `...#/fixtures/1/source` references `update-cases.v1.jsonl`, which is absent.
   - `...#/fixtures/2/source` references `temporal-cases.v1.jsonl`, which is absent.
   - The same missing files are named under `#/hostSuites/0/groundTruth/paths`, `#/hostSuites/1/groundTruth/paths`, and `#/hostSuites/2/groundTruth/paths`. The B18 report explicitly lists freezing and committing these inputs as a prerequisite: `.ptah/specs/TASK_2026_620_a13e/batch-18-report.md:167-170,182-190`.
   - Add/commit the three Batch-25 fixtures (and their frozen ground truth) before recording B18; do not change the plan to point at a different fixture set without an approved design update.

2. **Verified — curator plans conform.** `extraction.record.json`, `b18-record.json` (apart from finding 1), and `scope-write.record.json` use `cassetteMode: "record"`, private `C:\Users\abdal\AppData\Local\ptah-mcp-bench\cassettes\...` targets, curator model `gpt-5.6-terra`, and exactly `memory.curatorProvider=openai-codex` / `memory.curatorModel=gpt-5.6-terra`. Those are the product setting keys read by the curator adapter (`libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts:53-55,220-226`) and are written beneath the `ptah` section by the host.

3. **Verified — funnel conforms.** `funnel-record.plan.json#/settings` supplies provider and model for archaeologist, synthesis, judge, and replay; its lane-runner cassette is `gpt-5.6-terra`; it contains no `judgeModel`. This matches the lane configuration (`libs/backend/skill-synthesis/src/lib/lanes/skill-lane-config.ts:48-67`). Its eleven suites are registered by `tools/mcp-bench/src/memory-skills/host/memory-skills-host.entry.ts:61-79` and are all last-placement suites (`tools/mcp-bench/src/memory-skills/host/suite-placement.ts:34-44`).

4. **Verified — isolation and plan safety.** No plan contains `oauthTokenEndpoint` or a secret-looking setting key. Every cassette path is outside committed fixtures. Extraction, scope-write, and funnel fixture sources and ground-truth paths exist. The scope-write plan contains only `mem.scope.write`, satisfying its empty-database requirement (`batch-19-report.md:134-140`). All four plans parse successfully with `parseRunnerPlan` from `tools/mcp-bench/src/memory-skills/runner/runner-plan.ts`; that schema-only check does not verify filesystem fixture existence, hence finding 1.

## Recording order and blockers

1. **Extraction** may record once the A1 isolated Codex-auth gate is available; it has no dependency on the other three recordings.
2. **B18** is blocked by finding 1 and by the stated Batch-25 frozen-ground-truth prerequisite. It is curator-only; its unused lane cassette correctly has model `none`.
3. **Scope-write** may record independently after the A1 auth gate, but must remain its own run (or be first in a multi-suite plan); this plan correctly runs it alone.
4. **Funnel** may record independently after Batch 24's 619 coordination (`batch-22-report.md:151-156`). It does not depend on extraction, B18, or scope-write recordings.

## Commands (after the applicable blockers are cleared)

```powershell
npx nx run mcp-bench:bench-memory-skills -- --plan C:\Users\abdal\AppData\Local\ptah-mcp-bench\plans\extraction.record.json --run-id extraction-record-v1 --codex-auth-source <ABS_AUTH>
npx nx run mcp-bench:bench-memory-skills -- --plan C:\Users\abdal\AppData\Local\ptah-mcp-bench\plans\b18-record.json --run-id b18-record-v1 --codex-auth-source <ABS_AUTH>
npx nx run mcp-bench:bench-memory-skills -- --plan C:\Users\abdal\AppData\Local\ptah-mcp-bench\plans\scope-write.record.json --run-id scope-write-record-v1 --codex-auth-source <ABS_AUTH>
npx nx run mcp-bench:bench-memory-skills -- --plan C:\Users\abdal\AppData\Local\ptah-mcp-bench\plans\funnel-record.plan.json --run-id funnel-record-v1 --codex-auth-source <ABS_AUTH>
```
