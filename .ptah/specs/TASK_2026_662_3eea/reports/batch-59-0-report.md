# Batch 59.0 — TUI Skills Library

## Files changed

- `apps/ptah-tui/src/components/thoth/SkillsPanel.tsx` — replaced the candidate panel with a read-only Library list.
- `apps/ptah-tui/src/components/thoth/SkillsPanel.spec.ts` — replaced promotion-outcome tests with Library rendering, degraded, empty, error, and refresh coverage.
- `apps/ptah-tui/src/components/thoth/promote-outcome.ts` — deleted after its panel import and re-export were removed; no other TUI import was found.
- `.ptah/specs/TASK_2026_662_3eea/reports/batch-59-0-report.md` — this report.

`ThothPanel.tsx:178` still passes the same `isActive`, `degraded`, and `reason` props, so it was not changed. No other skills-panel help string advertised promotion or rejection.

## Removed TUI capabilities

- Candidate promotion and its outcome display.
- Candidate rejection.
- Candidate detail view.
- Candidate and promotion/rejection stats, including the status filter.

The panel no longer calls `skillSynthesis:stats`, `listCandidates`, `getCandidate`, `promote`, or `reject`.

## New behavior

The panel calls only `skillSynthesis:listClones`. It shows every Library entry with its kind, slug, invocation count, and rounded whole-percent success rate. A null or non-finite rate reads `No grade`; a numeric zero reads `0%`. It retains up/down navigation and uses `R` to refresh. Loading, empty, degraded, and generic RPC failure states are shown. The header says `Skills Library` and points editing to the desktop app or VS Code.

## Decisions

- **Display name:** Use `CloneSummary.slug`. The retained `CloneSummary` contract has `slug` and no separate name; this is reversible if a display name is later added.
- **Failure text:** Show a generic load error and permit `R` retry. `useRpc` may return `null` on transport failure, and raw transport errors should not be displayed. This is reversible.
- **Grade:** Match the retained Library formatter: multiply the rate by 100 and round; preserve null as `No grade`. This is reversible.

## Verification and limits

- Inspected the retained RPC contract in `rpc.types.ts` and `rpc-skill-clone.types.ts`, the existing panel, its spec, and `ThothPanel.tsx`.
- Searched TUI source for promotion/rejection help and `promote-outcome` imports. No remaining skills-panel help or import was found.
- Did not run tests, typecheck, lint, build, Nx, Jest, or diagnostics, as explicitly required by the task instructions. The orchestrator owns those checks.
