# Batch 10d.P-fix-2 report

## Changes

1. **D1:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-lane-parity.spec.ts:168-219,309-384` now uses one adapter, runtime provider and thread-identity map for both same-home lanes. The case interleaves A start, B start, A follow-up and B resume, then checks each `open` profile's cwd, disabled user MCP names, instructions and permission level, including absence of the other lane's values.
2. **D2:** `libs/backend/cli-agent-runtime/src/lib/cli-agents/codex-lane-activation.spec.ts:223-278,289-338` adds one real `CodexAppServerLaneAdapter` integration case with a test-double runtime. Native terminal usage enters manager context accounting and the ledger, the rollout figure reaches the resume gate, and an attributed report reaches the parent router. Stub-adapter cases remain at `:340-481`; the proof labels them **shared manager contract (adapter-agnostic)**.
3. **D3:** `.ptah/specs/TASK_2026_714_c8a2/p10-lane-parity-proof.md:11-65,69,75,92-93` updates every P/A case citation against the final 443-line parity spec and 482-line activation spec. The case count is 16; Signature remains unsigned at `:101-103`.
4. **D4:** `codex-lane-parity.spec.ts:386-406` names the direct approval-sink behavior precisely. Proof rows 22 and 25 (`p10-lane-parity-proof.md:11,14`) claim one decline and one safe output line per direct sink request; runtime delivery remains a live observation.
5. **D5:** `codex-lane-parity.spec.ts:408-428` supplies `ptah` alongside a user MCP server and checks that only the user server is disabled while the Ptah MCP entry remains enabled. Proof row 41 is at `p10-lane-parity-proof.md:30`.
6. **D6:** `codex-lane-activation.spec.ts:340-386` asserts the actual gate decisions use rollout source and 20,000 context tokens for resume, then 160,000 for fresh. The manager's gate log is checked too. Proof row: `p10-lane-parity-proof.md:62`.
7. **D7:** `codex-lane-activation.spec.ts:388-440` adds a completed run carrying usage, separates the known-owner usage-unknown run from the unknown-owner run, and asserts `recordWindowEvidence` is not called for these Codex cases. Proof row: `p10-lane-parity-proof.md:64`.

## Evidence

- Ptah AST analysis parsed both edited specs with zero syntax error nodes.
- Final case ranges were read from the edited files before proof citations were updated.
- Tests, diagnostics, verify, typecheck, lint, build, Nx and npm were not run under the task's hard rules. Pass/fail counts and type correctness are therefore unverified; the coordinator must run the scoped checks.
- No production code was edited, and no real Codex process or model/network call was started.

## Decisions

1. Kept the approval test at the adapter's injected sink and narrowed the proof claim. The alternatives were simulating a runtime event or describing the direct sink contract; the adapter discards approval events, while the runtime's injected sink is the intended approval seam (`codex-app-server-lane.adapter.ts:248-255,365-366`). Reversible if runtime delivery is later tested directly.
2. Asserted no window evidence for Codex quota cases. The Codex limit classifier returns owner-level evidence for the usage-limit wording (`limits/lane-limit-classifier.ts:131-140`); a positive window assertion would test another provider's rule. Reversible if Codex classification changes.
3. Retained static PASS as provisional and left the signature unsigned. The task forbids running the specs and a pinned live App Server; coordinator checks and authorized live observations remain necessary before signing.

## Not done

- No requested item was omitted. Execution and live proof remain with the coordinator because the task explicitly prohibits them.
