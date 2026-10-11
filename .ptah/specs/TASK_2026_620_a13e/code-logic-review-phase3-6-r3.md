# Phase 3.6 code-logic review — round 3

## Summary

| Metric | Value |
|---|---|
| Assessment | APPROVED |
| Round-2 serious finding | CLOSED |
| New findings | None |

The fixture is again independent ground truth: it specifies the TASK_2026_588-correct observable result, and the current product path now fails that expectation rather than defining it.  The correction does not claim a product change.

## Finding status

| Finding | Status | Evidence | Impact |
|---|---|---|---|
| Sessions 20–22 normalized the single-session/no-routine authoring bug by expecting `analyze-run`. | **CLOSED** | The generator classifies the three no-routine single-edit cases as `archaeology-no-routine` (`tools/mcp-bench/src/memory-skills/ground-truth/skill-session-fixture.ts:120-143`) and maps that operation to `ineligible:noRoutine` (`:64-91`). The committed fixture has the same script and expectation for sessions 20–22 (`tools/mcp-bench/fixtures/memory-skills/skill-sessions.v1/index.json:237-270`), and the golden spec pins it (`skill-session-fixture.spec.ts:97-105`). | Feed parity now reports the current premature draft as a failure, preserving the Phase 4 588 work item instead of hiding it. |

`noRoutine` is deliberately fixture-only, design-required ground truth rather than a claim that the existing product emits it (`skill-session-fixture.ts:23-36`). The product event union remains unchanged; that is why the expected current outcome is a failure, explicitly recorded in `batch-11-1-report.md:119-127` and `batch-22-report.md:228-244`.

## Reason preservation and parity result

No code path filters, substitutes, or remaps an unfamiliar ineligible reason. `eventKey` preserves every ineligible event as `ineligible:<reason>` (`tools/mcp-bench/src/memory-skills/suites/skills/funnel-stages.ts:597-601`), while `scoreFeedParity` compares those exact expected and observed keys and records both missing and phantom events (`:628-685`). The changed suite assertion confirms the intended present-day result: each of the three cases is expected `ineligible:noRoutine`, observed `analyze-run`, and fails (`funnel.suite.spec.ts:234-265`).

Fixture integrity is also pinned: the golden-fixture test compares the generated index to committed bytes and checks every JSONL file (`skill-session-fixture.spec.ts:108-134`), and the index SHA-256 matches its MANIFEST entry (`67b7660740c093ecd7652d64ec02865c2cc2a462f36247239e137fbf91c981f9`).

## Verification

- Scoped diagnostics for changed TypeScript paths: 0 errors, 0 warnings.
- Tests: `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/memory-skills --runInBand` — **Tests: 578 passed, 578 total** (51 suites; 94.03 s).

## Verdict

**APPROVED.** The prior serious benchmark-ground-truth defect is closed. No new logic defect was evidenced in the final correction. The product is intentionally still failing the 588 case, and the benchmark now exposes that failure honestly.
