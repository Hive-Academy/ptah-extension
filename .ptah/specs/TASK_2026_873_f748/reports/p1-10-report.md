# P1-10 — Dry-run publication stage and fixture

## Files

- `libs/backend/review-core/src/lib/stages/publication-stage.runner.ts` and `.spec.ts`: dry-run classification, preview/export, weaker evidence, unavailable coverage, suppression and inline cap.
- `src/lib/testing/dry-run-fixture.spec.ts`: queue-to-publication fixture with migrated SQLite, fake GitHub and stage runners, filesystem artifacts and restart readback.
- `src/lib/lanes/review-artifact.writer.ts`: read walkthrough, render verification labels, write redacted JSON export.
- `src/lib/review-orchestrator.service.ts` and `.spec.ts`: publication stage and checkpoint after verification.
- `src/di/tokens.ts`, `src/di/registration.ts`, `src/index.ts`: artifact writer/files port and publication stage wiring.

## Flow

Discovery enqueues fixture PR → real SQLite queue claims attempt → fake context, triage, lens and verifier stages provide deterministic outputs → publication reads local walkthrough → writes `out/review-preview.md` and `out/review-export.json` → coordinator checkpoints publication and stores preview path on stage row → SQLite connection closes and reopens → test reads stage history and both files. Publication stage has no GitHub port and invokes no GitHub mutation.

## AC to spec

| Acceptance | Spec evidence |
| --- | --- |
| AC-2.4/2.5 | `dry-run-fixture.spec.ts` reopens migrated SQLite and reads stages, publication artifact path and export. |
| AC-3.3/3.4 | Fixture uses no UI and asserts GitHub mutation fakes were never called; publication stage has no mutation dependency. |
| AC-10.1/10.2 | `publication-stage.runner.spec.ts` checks suppressed reason, five accepted candidates, 2/2 inline cap and overflow; existing writer spec covers default 10 cap. |
| AC-10.3/10.4 | Publication obtains effective settings each run; writer keeps previously published separate. Spec checks default Minor suppresses Nitpick. |
| FR-7 weaker label | Publication spec and fixture assert preview says “weaker evidence”; export carries `same-family-weaker`. |
| Unavailable checks | Publication spec and fixture assert `checks:unavailable` / `lint:unavailable` stays in preview coverage. |

## Decisions

- **Dry-run boundary:** publication depends on artifact writer, policy and environment only; GitHub mutation methods are absent from its constructor. Evidence: P1 dry-run rule. Reversible for later publication phase with an explicit capability.
- **Export shape:** write structured JSON with accepted, suppressed, verification labels, coverage and effective settings. Redact strings without Markdown escaping so finding paths remain machine-readable. Reversible with a versioned export schema.
- **Restart fixture:** use a temporary file-backed SQLite database with migration 65 so closing and reopening proves durability. A pure `:memory:` database is destroyed when the last connection closes and cannot prove restart persistence. Reversible if a supported shared-memory reconnect mechanism is added.
- **Uncertain verdicts:** suppress disproved, inconclusive and unavailable candidates with explicit reasons; accepted verdicts remain subject to writer severity and confidence gates. Reversible with adjudication rules.

## Open issues for P1-13 and P1-16

- P1-13: consume `review-export.json` schemaVersion 1 and verification labels; align replay result matching and suppression semantics.
- P1-16: bind `REVIEW_CORE_TOKENS.ARTIFACT_FILES` to a guarded filesystem adapter; supply the existing GitHub/environment ports. Ensure attempt `out/` exists and artifact files remain private.
- The fixture uses fake context/triage/lens/verifier implementations and a real queue, repository and artifact writer. It does not exercise real git, lanes or UI. P1-16 needs host integration coverage.

## Verification

Scoped `ptah_get_diagnostics` on changed TypeScript files reported zero errors. Nx/Jest were not run in this lane under D26; the parent should run `npm run verify -- -p review-core`.
