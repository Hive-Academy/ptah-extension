# Batch 18 report

## Files written

- `libs/frontend/onboarding/src/lib/ready/connection-readiness-banner.component.ts`
- `libs/frontend/onboarding/src/lib/ready/connection-readiness-banner.component.spec.ts`
- `libs/frontend/onboarding/src/lib/ready/ready-strip.component.ts`
- `libs/frontend/onboarding/src/lib/ready/ready-strip.component.spec.ts`
- `libs/frontend/onboarding/src/lib/ready/ready-settings-step.page.ts`
- `libs/frontend/onboarding/src/lib/ready/ready-settings-step.page.spec.ts`
- `.ptah/specs/TASK_2026_864_1376/batch-18-report.md`

## Banner visibility table

| Selection | Readiness | Banner |
| --- | --- | --- |
| Claude Code or Codex chosen | missing, signed-out, stale, terminal error | Shown for chosen provider |
| Claude Code or Codex chosen | checking, slow, ready | Hidden |
| Loading, unreadable, not-confirmed, other provider | Any | Hidden |

Claude leads and actions for missing, signed-out and error match the previous banner. The body names the main connection without a dependency claim. The banner uses role=status and the specified theme-aware color-mix tint.

## Strip item 1 mapping

| Selection/state | Label and word | Marker |
| --- | --- | --- |
| Chosen Claude Code or Codex, checking/slow/ready | Provider name; Checking/Taking longer/Ready | checking/checking/done |
| Chosen provider, missing/signed-out/stale/error | Provider name; Needs install/Needs sign-in/Needs sign-in/Could not check | need |
| Other provider | Its name; Set in Providers | idle |
| Loading | Connection; Checking | checking |
| Unreadable or not-confirmed | Connection; Not confirmed | idle |

The nonchosen provider does not affect item 1. Items 2 and 3 remain unchanged. Legacy Claude input remains optional for the existing Home caller.

## Decisions

- **Decision:** Keep the Claude banner's existing missing, signed-out and error leads and actions, while replacing its dependency-claim body. Options: retain old body or use the design's provider-neutral main-connection sentence. Evidence: D-7 and design section 8 explicitly remove the unsupported claim. Reversible: yes.
- **Decision:** Stage 2 calls `refresh('mount')` and reads `chosen` from `ProviderReadinessStore`. Options: keep the legacy Claude store or use Batch 17's chosen-connection store. Evidence: Batch 17 API and Task 18.3. Reversible: yes.
- **Decision:** When no provider is chosen, the stage 2 lead reads “Choose what Ptah can use.” Options: name “Connection” or use a neutral sentence. Evidence: Task 18.3 requests a neutral form. Reversible: yes.

## Risks and verification

Scoped Ptah diagnostics were attempted twice after edits. Both calls returned unavailable because the TypeScript check was still running after 45 seconds; all six source/spec files remain unchecked by that tool. The orchestrator owns `npm run verify -- -p @ptah-extension/onboarding`; this lane ran no tests, build, application target, or git command. No UI render or screenshot was available within the permitted task scope. The `angular-frontend-patterns` skill could not be loaded because this host exposes no skill loader.
